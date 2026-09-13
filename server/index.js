import "dotenv/config";
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { PRICING, calculateTotalCents, formatMoney } from "./pricing.js";
import { makeTransporter, sendOrderEmail } from "./mailer.js";
import { sendSms, smsConfigured } from "./sms.js";
import { validateLead, saveLead, rateLimit, formatLeadSms, formatWhen } from "./leads.js";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORDERS_PATH = path.join(__dirname, "orders.json");

// Render/most hosts terminate TLS at a proxy; needed for a real req.ip.
app.set("trust proxy", 1);

/**
 * CORS allowlist.
 *
 * CLIENT_ORIGIN may hold several origins, comma separated, so the apex domain,
 * the www subdomain and any preview deploy all work. Localhost is always
 * allowed for development. If CLIENT_ORIGIN is unset we fall back to open CORS
 * rather than silently sending no headers at all - that failure mode blocks
 * every browser request and quietly loses leads.
 */
const ALLOWED_ORIGINS = String(process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map(o => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

if (!ALLOWED_ORIGINS.length) {
  console.warn("[cors] CLIENT_ORIGIN not set - allowing all origins.");
}

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header: curl, server-to-server, Stripe webhooks.
      if (!origin) return callback(null, true);
      if (!ALLOWED_ORIGINS.length) return callback(null, true);

      const normalized = origin.replace(/\/$/, "");
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized);

      if (isLocalhost || ALLOWED_ORIGINS.includes(normalized)) return callback(null, true);

      console.warn(`[cors] Blocked origin: ${origin}`);
      return callback(null, false);
    }
  })
);
app.use(express.json());
app.get("/", (req, res) => {
res.send("Server is running. Use /api/pricing");
});
app.get("/api/pricing", (req, res) => res.json(PRICING));

app.get("/api/health", (req, res) =>
  res.json({ ok: true, sms: smsConfigured() })
);

/**
 * Contact / lead capture. Texts the owner the moment someone leaves info.
 * The lead is saved and a 200 returned even if the text fails, so a Twilio
 * outage never shows the visitor an error after they already hit send.
 */
app.post("/api/lead", async (req, res) => {
  // Honeypot: a real person never fills a field they cannot see.
  if (String(req.body?.company_website ?? "").trim()) {
    return res.json({ ok: true });
  }

  const { ok, error, lead } = validateLead(req.body);
  if (!ok) return res.status(400).json({ error });

  const limit = rateLimit(req.ip || "unknown");
  if (!limit.allowed) {
    return res.status(429).json({
      error: "You've already sent a few messages. We'll be in touch shortly."
    });
  }

  const record = { ...lead, created_at: new Date().toISOString(), ip: req.ip };

  try {
    saveLead(record);
  } catch (err) {
    console.error("[lead] Could not write leads.json:", err?.message || err);
  }

  // Text first - it is the notification that actually reaches a phone.
  let texted = false;
  try {
    const result = await sendSms(formatLeadSms(lead));
    texted = !result.skipped && result.results.some(r => r.ok);
  } catch (err) {
    console.error("[lead] SMS alert failed:", err?.message || err);
  }

  // Email is the backup copy, and only if mail is configured.
  if (process.env.EMAIL_HOST && process.env.ORDER_RECEIVER_EMAIL) {
    try {
      await sendOrderEmail({
        transporter: makeTransporter(process.env),
        to: process.env.ORDER_RECEIVER_EMAIL,
        subject: `New lead: ${lead.business || lead.name}`,
        html: `
          <h2>New website lead</h2>
          <p><b>Name:</b> ${escapeHtml(lead.name)}</p>
          <p><b>Business:</b> ${escapeHtml(lead.business || "-")}</p>
          <p><b>Phone:</b> ${escapeHtml(lead.phone || "-")}</p>
          <p><b>Email:</b> ${escapeHtml(lead.email || "-")}</p>
          <p><b>Interested in:</b> ${escapeHtml(lead.service || "-")}</p>
          <p><b>Wants to be reached:</b> ${escapeHtml(formatWhen(lead.preferred_date, lead.preferred_time) || "-")}</p>
          <p><b>Message:</b><br/>${escapeHtml(lead.message || "-")}</p>
        `
      });
    } catch (err) {
      console.error("[lead] Email copy failed:", err?.message || err);
    }
  }

  res.json({ ok: true, texted });
});

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

    // They left their details and are heading to Stripe - worth knowing even
    // if they never finish paying. Never let a failed text block checkout.
    sendSms(
      [
        "Checkout started - Nova Web Co",
        "",
        customer.name,
        customer.business,
        customer.email,
        `Total: $${formatMoney(totalCents)} ${PRICING.currency.toUpperCase()}`,
        `Package: ${selections.package}`
      ].join("\n")
    ).catch(err => console.error("[sms] checkout alert failed:", err?.message || err));

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

    try {
        await sendSms(
        [
            "PAID ORDER - Nova Web Co",
            "",
            customerName,
            business,
            customerEmail,
            `$${formatMoney(order.total_cents)} ${PRICING.currency.toUpperCase()}`
        ].join("\n")
        );
    } catch (err) {
        console.error("[sms] paid-order alert failed:", err?.message || err);
    }
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Text alerts: ${smsConfigured() ? "enabled" : "NOT configured (see .env.example)"}`);
});