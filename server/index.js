import "dotenv/config";
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { PRICING, calculateTotalCents, formatMoney } from "./pricing.js";
import { makeTransporter, sendOrderEmail } from "./mailer.js";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORDERS_PATH = path.join(__dirname, "orders.json");

app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(express.json());

app.get("/api/pricing", (req, res) => res.json(PRICING));

function readOrders() {
  if (!fs.existsSync(ORDERS_PATH)) return [];
  return JSON.parse(fs.readFileSync(ORDERS_PATH, "utf8"));
}
function writeOrders(orders) {
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
}

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { customer, selections } = req.body ?? {};

    if (!customer?.name || !customer?.email || !customer?.business) {
      return res.status(400).json({ error: "Missing customer fields." });
    }
    if (!selections?.package) {
      return res.status(400).json({ error: "Missing package selection." });
    }

    const totalCents = calculateTotalCents(selections);
    if (totalCents < 5000) {
      return res.status(400).json({ error: "Total too low." });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: customer.email,
      success_url: process.env.SUCCESS_URL + "?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: process.env.CANCEL_URL,
      line_items: [
        {
          price_data: {
            currency: PRICING.currency,
            product_data: { name: "Website Build Order" },
            unit_amount: totalCents
          },
          quantity: 1
        }
      ],
      metadata: {
        customer_name: customer.name,
        customer_email: customer.email,
        customer_business: customer.business,
        selections_json: JSON.stringify(selections)
      }
    });

    const orders = readOrders();
    orders.push({
      created_at: new Date().toISOString(),
      name: customer.name,
      email: customer.email,
      business: customer.business,
      selections,
      total_cents: totalCents,
      stripe_session_id: session.id,
      paid: false
    });
    writeOrders(orders);

    res.json({ url: session.url });
  } catch {
    res.status(500).json({ error: "Server error creating checkout session." });
  }
});

// Webhook must use raw body
app.post("/api/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch {
    return res.status(400).send("Webhook Error");
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const sessionId = session.id;

    const selections = safeJson(session.metadata?.selections_json) ?? {};
    const customerName = session.metadata?.customer_name ?? "Unknown";
    const customerEmail = session.metadata?.customer_email ?? "Unknown";
    const business = session.metadata?.customer_business ?? "Unknown";

    const orders = readOrders();
    const order = orders.find(o => o.stripe_session_id === sessionId);

    if (order && !order.paid) {
      order.paid = true;
      writeOrders(orders);

      const transporter = makeTransporter(process.env);

      const html = `
        <h2>New Paid Website Order</h2>
        <p><b>Name:</b> ${escapeHtml(customerName)}</p>
        <p><b>Email:</b> ${escapeHtml(customerEmail)}</p>
        <p><b>Business:</b> ${escapeHtml(business)}</p>
        <p><b>Total:</b> $${formatMoney(order.total_cents)} ${PRICING.currency.toUpperCase()}</p>
        <h3>Selections</h3>
        <pre>${escapeHtml(JSON.stringify(selections, null, 2))}</pre>
        <p><b>Stripe Session:</b> ${escapeHtml(sessionId)}</p>
      `;

      try {
        await sendOrderEmail({
          transporter,
          to: process.env.ORDER_RECEIVER_EMAIL,
          subject: `Paid Website Order: ${business}`,
          html
        });
      } catch {}
    }
  }

  res.json({ received: true });
});

function safeJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

app.listen(process.env.PORT, () => {
  console.log(`Server running on http://localhost:${process.env.PORT}`);
});