/* ============================================================
   Nova Web Co - front end
   ============================================================ */

// Point at a local server when developing, the deployed one otherwise.
const API =
  location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "https://nova-web-co-server.onrender.com";

/**
 * Mirror of server/pricing.js. Rendered instantly so the page is never empty,
 * then replaced by the server's copy once it answers (the free Render tier can
 * take ~30s to wake up).
 */
const FALLBACK_PRICING = {
  currency: "cad",
  base: {
    starter: { name: "Starter Website", cents: 79900, includes: ["Up to 5 pages", "Mobile friendly", "Contact form"] },
    business: { name: "Business Website", cents: 149900, includes: ["Up to 10 pages", "SEO basics", "Analytics setup"] },
    advanced: { name: "Advanced Website", cents: 299900, includes: ["Custom features", "Integrations", "Performance tuning"] },
    ecommerce: { name: "E-Commerce Website", cents: 249900, includes: ["Products", "Payments", "Shipping basics"] }
  },
  addons: {
    extra_pages: { name: "Extra Pages (per 5)", cents: 25000 },
    seo_plus: { name: "SEO Plus", cents: 50000 },
    copywriting: { name: "Copywriting", cents: 40000 },
    branding: { name: "Logo + Branding Kit", cents: 35000 },
    booking: { name: "Booking System", cents: 60000 },
    blog: { name: "Blog Setup", cents: 30000 },
    speed: { name: "Speed + Core Web Vitals", cents: 45000 },
    multilingual: { name: "Second Language", cents: 70000 }
  },
  monthly: {
    maintenance: { name: "Maintenance", cents: 9900 },
    hosting: { name: "Hosting", cents: 1500 },
    seo_monthly: { name: "Monthly SEO", cents: 19900 }
  }
};

const FEATURED_PACKAGE = "business";

let PRICING = FALLBACK_PRICING;

const $ = id => document.getElementById(id);

const el = {
  pricingCards: $("pricingCards"),
  packageOptions: $("packageOptions"),
  addonOptions: $("addonOptions"),
  monthlyOptions: $("monthlyOptions"),
  summary: $("summary"),
  totalDue: $("totalDue"),
  orderForm: $("orderForm"),
  formError: $("formError"),
  checkoutBtn: $("checkoutBtn"),
  contactForm: $("contactForm"),
  contactError: $("contactError"),
  contactSuccess: $("contactSuccess"),
  contactBtn: $("contactBtn"),
  contactDate: $("c_date"),
  contactTime: $("c_time"),
  year: $("year")
};

async function init() {
  if (el.year) el.year.textContent = new Date().getFullYear();

  // Everything below renders from the fallback, so the page is complete
  // immediately even if the API is asleep or unreachable.
  renderPortfolio();
  renderPricing();
  renderFormOptions();
  wireOrderForm();
  wireContactForm();
  updateSummary();
  initScrollAnimations();

  try {
    const live = await fetchPricing();
    if (live?.base) {
      PRICING = live;
      renderPricing();
      renderFormOptions();
      updateSummary();
    }
  } catch (err) {
    // Not fatal: the published prices are already on screen.
    console.warn("Live pricing unavailable, showing published rates:", err.message);
  }
}

async function fetchPricing() {
  const res = await fetch(`${API}/api/pricing`);
  if (!res.ok) throw new Error(`Pricing fetch failed (${res.status})`);
  return res.json();
}

function money(cents) {
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ---------------- contact form: this is what texts the owner ------------- */

/**
 * Fills the date and time pickers.
 *
 * The date is bounded to today..+1 year so nobody asks for a callback in the
 * past, and the times are fixed half-hour slots inside business hours rather
 * than a free time input - it keeps 3am off the calendar and matches what the
 * server accepts.
 */
function initBookingFields() {
  const dateInput = el.contactDate;
  const timeSelect = el.contactTime;

  if (dateInput) {
    const today = new Date();
    const iso = d =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const nextYear = new Date(today);
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    dateInput.min = iso(today);
    dateInput.max = iso(nextYear);

    // Default to the next weekday, so the common case is one tap.
    const suggested = new Date(today);
    suggested.setDate(suggested.getDate() + 1);
    while (suggested.getDay() === 0 || suggested.getDay() === 6) {
      suggested.setDate(suggested.getDate() + 1);
    }
    dateInput.value = iso(suggested);
  }

  if (timeSelect) {
    const slots = ['<option value="">Choose a time…</option>'];

    for (let minutes = 8 * 60; minutes <= 19 * 60; minutes += 30) {
      const hh = Math.floor(minutes / 60);
      const mm = minutes % 60;
      const value = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      const label = `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
      slots.push(`<option value="${value}">${label}</option>`);
    }

    timeSelect.innerHTML = slots.join("");
  }
}

function wireContactForm() {
  const form = el.contactForm;
  if (!form) return;

  initBookingFields();

  form.addEventListener("submit", async e => {
    e.preventDefault();

    hide(el.contactError);
    hide(el.contactSuccess);

    const fd = new FormData(form);
    const payload = {
      name: str(fd.get("name")),
      business: str(fd.get("business")),
      phone: str(fd.get("phone")),
      email: str(fd.get("email")),
      service: str(fd.get("service")),
      preferred_date: str(fd.get("preferred_date")),
      preferred_time: str(fd.get("preferred_time")),
      message: str(fd.get("message")),
      company_website: str(fd.get("company_website")), // honeypot
      source: "homepage contact form"
    };

    if (!payload.name) return failContact("Add your name so I know who I'm replying to.");
    if (!payload.phone && !payload.email) {
      return failContact("Add a phone number or an email so I can get back to you.");
    }
    if (!payload.preferred_date) return failContact("Pick the day that suits you best.");
    if (!payload.preferred_time) return failContact("Pick a time that suits you best.");

    setBusy(el.contactBtn, true, "Sending...");

    try {
      const res = await fetch(`${API}/api/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Something went wrong sending that.");

      form.reset();
      initBookingFields();
      show(
        el.contactSuccess,
        "Got it — that just hit my phone. I'll be in touch shortly, usually the same day."
      );
      el.contactSuccess?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      failContact(
        `${err.message} You can also reach me directly and I'll pick it up from there.`
      );
    } finally {
      setBusy(el.contactBtn, false, "Send it — I'll text you back");
    }
  });
}

function failContact(msg) {
  show(el.contactError, msg);
}

/* ---------------------------- pricing cards ------------------------------ */

function renderPricing() {
  if (!el.pricingCards) return;

  el.pricingCards.innerHTML = Object.entries(PRICING.base)
    .map(([key, p]) => {
      const featured = key === FEATURED_PACKAGE;
      return `
        <div class="card${featured ? " featured" : ""}">
          ${featured ? '<div class="card-tag">Most picked</div>' : ""}
          <h3>${escapeHtml(p.name)}</h3>
          <div class="total-number">${escapeHtml(money(p.cents))}</div>
          <ul>${p.includes.map(b => `<li>${escapeHtml(b)}</li>`).join("")}</ul>
        </div>
      `;
    })
    .join("");
}

/* ---------------------------- order form --------------------------------- */

function renderFormOptions() {
  if (el.packageOptions) {
    el.packageOptions.innerHTML = Object.entries(PRICING.base)
      .map(
        ([key, p]) => `
      <label class="option">
        <input type="radio" name="package" value="${escapeHtml(key)}" ${key === FEATURED_PACKAGE ? "checked" : ""} />
        <div>
          <strong>${escapeHtml(p.name)} · ${escapeHtml(money(p.cents))}</strong>
          <div class="desc">${escapeHtml(p.includes.join(" · "))}</div>
        </div>
      </label>`
      )
      .join("");
  }

  if (el.addonOptions) {
    el.addonOptions.innerHTML = Object.entries(PRICING.addons)
      .map(
        ([key, p]) => `
      <label class="option">
        <input type="checkbox" name="addon" value="${escapeHtml(key)}" />
        <div>
          <strong>${escapeHtml(p.name)} · ${escapeHtml(money(p.cents))}</strong>
          <div class="desc">One-time</div>
        </div>
      </label>`
      )
      .join("");
  }

  if (el.monthlyOptions) {
    el.monthlyOptions.innerHTML = Object.entries(PRICING.monthly)
      .map(
        ([key, p]) => `
      <label class="option">
        <input type="checkbox" name="monthly" value="${escapeHtml(key)}" />
        <div>
          <strong>${escapeHtml(p.name)} · ${escapeHtml(money(p.cents))}/mo</strong>
          <div class="desc">Charged upfront for the months you commit</div>
        </div>
      </label>`
      )
      .join("");
  }
}

function wireOrderForm() {
  const form = el.orderForm;
  if (!form) return;

  form.addEventListener("change", updateSummary);
  form.addEventListener("input", updateSummary);

  form.addEventListener("submit", async e => {
    e.preventDefault();
    hide(el.formError);

    const payload = buildPayload();
    if (!payload) return;

    setBusy(el.checkoutBtn, true, "Creating checkout...");

    try {
      const res = await fetch(`${API}/api/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Checkout failed");

      window.location.href = data.url;
    } catch (err) {
      show(el.formError, String(err.message || err));
    } finally {
      setBusy(el.checkoutBtn, false, "Go to checkout");
    }
  });
}

function readSelections() {
  const form = el.orderForm;
  const fd = new FormData(form);

  return {
    package: str(fd.get("package")) || FEATURED_PACKAGE,
    addons: [...form.querySelectorAll('input[name="addon"]:checked')].map(i => i.value),
    monthly: [...form.querySelectorAll('input[name="monthly"]:checked')].map(i => i.value),
    monthly_commit_months: Math.max(0, Number(fd.get("commitMonths") || 0)),
    notes: str(fd.get("notes"))
  };
}

function buildPayload() {
  const fd = new FormData(el.orderForm);

  const customer = {
    name: str(fd.get("name")),
    email: str(fd.get("email")),
    business: str(fd.get("business"))
  };

  if (!customer.name || !customer.email || !customer.business) {
    show(el.formError, "Fill in your name, email and business name first.");
    return null;
  }

  return { customer, selections: readSelections() };
}

function updateSummary() {
  if (!el.orderForm || !el.summary || !el.totalDue) return;

  const sel = readSelections();
  const parts = [];

  const base = PRICING.base[sel.package];
  if (base) parts.push(["Package", `${base.name} — ${money(base.cents)}`]);

  for (const k of sel.addons) {
    const a = PRICING.addons[k];
    if (a) parts.push(["Add-on", `${a.name} — ${money(a.cents)}`]);
  }

  const monthlyTotal = sel.monthly
    .map(k => PRICING.monthly[k]?.cents ?? 0)
    .reduce((a, b) => a + b, 0);

  if (monthlyTotal > 0 && sel.monthly_commit_months > 0) {
    parts.push([
      "Monthly upfront",
      `${money(monthlyTotal)}/mo × ${sel.monthly_commit_months} = ${money(monthlyTotal * sel.monthly_commit_months)}`
    ]);
  } else if (monthlyTotal > 0) {
    parts.push(["Monthly care", `${money(monthlyTotal)}/mo — billed separately`]);
  }

  el.summary.innerHTML = parts.length
    ? parts
        .map(
          ([k, v]) => `
      <div class="summary-item">
        <div class="muted small">${escapeHtml(k)}</div>
        <div>${escapeHtml(v)}</div>
      </div>`
        )
        .join("")
    : '<p class="muted small" style="margin:0">Pick a package to see your total.</p>';

  el.totalDue.textContent = money(calcTotal(sel));
}

function calcTotal(sel) {
  const base = PRICING.base[sel.package]?.cents ?? 0;
  const addons = (sel.addons || []).map(k => PRICING.addons[k]?.cents ?? 0).reduce((a, b) => a + b, 0);
  const monthly = (sel.monthly || []).map(k => PRICING.monthly[k]?.cents ?? 0).reduce((a, b) => a + b, 0);

  return base + addons + monthly * (sel.monthly_commit_months || 0);
}

/* ---------------------------- industries --------------------------------- */

const demos = [
  { id: "snow", name: "Snow Removal & Lawn", desc: "Service-area map and seasonal contract signup", img: "https://images.unsplash.com/photo-1517204824045-ce0217983c2a?q=80&w=600&auto=format&fit=crop", link: "#contact" },
  { id: "medical", name: "Medical Clinic", desc: "Private-by-default booking and patient FAQ", img: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?q=80&w=600&auto=format&fit=crop", link: "#contact" },
  { id: "detailing", name: "Mobile Detailing", desc: "Before/after gallery and package selector", img: "https://images.unsplash.com/photo-1601362840469-51e4d8d58785?q=80&w=600&auto=format&fit=crop", link: "#contact" },
  { id: "handyman", name: "Handyman Services", desc: "Dynamic project estimate calculator", img: "https://images.unsplash.com/photo-1581141849291-1125c7b692b5?q=80&w=600&auto=format&fit=crop", link: "#contact" },
  { id: "bakery", name: "Bakery & Catering", desc: "Visual menu and custom order forms", img: "https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=600&auto=format&fit=crop", link: "#contact" },
  { id: "braiding", name: "Hair Braiding Studio", desc: "Style selector with deposit checkout", img: "https://images.unsplash.com/photo-1560014676-127e434f0c86?q=80&w=600&auto=format&fit=crop", link: "#contact" },
  { id: "tutoring", name: "Tutoring Service", desc: "Subject filters and a parent contact portal", img: "https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?q=80&w=600&auto=format&fit=crop", link: "#contact" },
  { id: "pet", name: "Mobile Pet Grooming", desc: "Breed and size selector with scheduling", img: "https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?q=80&w=600&auto=format&fit=crop", link: "#contact" },
  { id: "chef", name: "Personal Chef", desc: "Dietary preference capture and meal plans", img: "https://images.unsplash.com/photo-1556910103-1c02745aae4d?q=80&w=600&auto=format&fit=crop", link: "#contact" },
  { id: "farm", name: "Farm / CSA Box", desc: "Subscription showcase and delivery zones", img: "https://images.unsplash.com/photo-1464226184884-fa280b87c399?q=80&w=600&auto=format&fit=crop", link: "#contact" }
];

function renderPortfolio() {
  const grid = $("portfolioGrid");
  if (!grid) return;

  grid.innerHTML = demos
    .map(
      d => `
    <a href="${escapeHtml(d.link)}" class="demo-card">
      <img src="${escapeHtml(d.img)}" alt="${escapeHtml(d.name)} website template" class="demo-image" loading="lazy" />
      <div class="demo-info">
        <h3 class="demo-title">${escapeHtml(d.name)}</h3>
        <div class="demo-desc">${escapeHtml(d.desc)}</div>
      </div>
    </a>`
    )
    .join("");
}

/* ------------------------------ helpers ---------------------------------- */

function initScrollAnimations() {
  const items = document.querySelectorAll(".reveal");

  if (!("IntersectionObserver" in window)) {
    items.forEach(elm => elm.classList.add("active"));
    return;
  }

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("active");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -40px" }
  );

  items.forEach(elm => observer.observe(elm));
}

function str(v) {
  return String(v ?? "").trim();
}

function show(node, text) {
  if (!node) return;
  node.textContent = text;
  node.hidden = false;
}

function hide(node) {
  if (node) node.hidden = true;
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = label;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Started last, so every const above is initialized by the time init() runs.
init();
