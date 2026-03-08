const API = "https://nova-web-co-server.onrender.com";

let PRICING = null;

const pricingCards = document.getElementById("pricingCards");
const packageOptions = document.getElementById("packageOptions");
const addonOptions = document.getElementById("addonOptions");
const monthlyOptions = document.getElementById("monthlyOptions");
const summaryEl = document.getElementById("summary");
const totalDueEl = document.getElementById("totalDue");
const form = document.getElementById("orderForm");
const formError = document.getElementById("formError");
const checkoutBtn = document.getElementById("checkoutBtn");

init();

async function init() {
  PRICING = await fetchPricing();
  renderPricing();
  renderFormOptions();
  wireUpdates();
  updateSummary();
}

async function fetchPricing() {
  const res = await fetch(`${API}/api/pricing`);
  if (!res.ok) throw new Error("Pricing fetch failed");
  return res.json();
}

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function renderPricing() {
  const cards = [];

  for (const [key, p] of Object.entries(PRICING.base)) {
    cards.push(cardHtml(p.name, money(p.cents), p.includes));
  }

  pricingCards.innerHTML = cards.join("");
}

function cardHtml(title, price, bullets) {
  return `
    <div class="card">
      <h3>${escapeHtml(title)}</h3>
      <div class="total-number">${escapeHtml(price)}</div>
      <ul class="muted small">
        ${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderFormOptions() {
  // Packages (radio)
  packageOptions.innerHTML = Object.entries(PRICING.base).map(([key, p], i) => `
    <label class="option">
      <input type="radio" name="package" value="${key}" ${i === 1 ? "checked" : ""} />
      <div>
        <strong>${escapeHtml(p.name)} · ${escapeHtml(money(p.cents))}</strong>
        <div class="desc">${escapeHtml(p.includes.join(" | "))}</div>
      </div>
    </label>
  `).join("");

  // Addons (checkbox)
  addonOptions.innerHTML = Object.entries(PRICING.addons).map(([key, p]) => `
    <label class="option">
      <input type="checkbox" name="addon" value="${key}" />
      <div>
        <strong>${escapeHtml(p.name)} · ${escapeHtml(money(p.cents))}</strong>
        <div class="desc">One-time</div>
      </div>
    </label>
  `).join("");

  // Monthly (checkbox)
  monthlyOptions.innerHTML = Object.entries(PRICING.monthly).map(([key, p]) => `
    <label class="option">
      <input type="checkbox" name="monthly" value="${key}" />
      <div>
        <strong>${escapeHtml(p.name)} · ${escapeHtml(money(p.cents))}/mo</strong>
        <div class="desc">Charged upfront based on your commitment</div>
      </div>
    </label>
  `).join("");
}

function wireUpdates() {
  form.addEventListener("change", updateSummary);
  form.addEventListener("input", updateSummary);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.hidden = true;

    const payload = buildPayload();
    if (!payload) return;

    checkoutBtn.disabled = true;
    checkoutBtn.textContent = "Creating checkout...";

    try {
      const res = await fetch(`${API}/api/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Checkout failed");

      window.location.href = data.url;
    } catch (err) {
      formError.textContent = String(err.message || err);
      formError.hidden = false;
    } finally {
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = "Go to checkout";
    }
  });
}

function buildPayload() {
  const fd = new FormData(form);

  const customer = {
    name: String(fd.get("name") || "").trim(),
    email: String(fd.get("email") || "").trim(),
    business: String(fd.get("business") || "").trim()
  };

  if (!customer.name || !customer.email || !customer.business) {
    formError.textContent = "Fill name, email, and business name.";
    formError.hidden = false;
    return null;
  }

  const selectedPackage = String(fd.get("package") || "");
  const addons = [...form.querySelectorAll('input[name="addon"]:checked')].map(i => i.value);
  const monthly = [...form.querySelectorAll('input[name="monthly"]:checked')].map(i => i.value);
  const monthlyCommit = Number(fd.get("commitMonths") || 0);

  const notes = String(fd.get("notes") || "").trim();

  return {
    customer,
    selections: {
      package: selectedPackage,
      addons,
      monthly,
      monthly_commit_months: monthlyCommit,
      notes
    }
  };
}

function updateSummary() {
  const payload = buildPayloadForSummary();
  const total = calcTotal(payload.selections);

  const parts = [];

  const base = PRICING.base[payload.selections.package];
  if (base) parts.push(["Package", `${base.name} (${money(base.cents)})`]);

  for (const k of payload.selections.addons) {
    const a = PRICING.addons[k];
    if (a) parts.push(["Add-on", `${a.name} (${money(a.cents)})`]);
  }

  const monthlyTotal = payload.selections.monthly
    .map(k => PRICING.monthly[k]?.cents ?? 0)
    .reduce((x, y) => x + y, 0);

  if (monthlyTotal > 0 && payload.selections.monthly_commit_months > 0) {
    parts.push([
      "Monthly upfront",
      `${money(monthlyTotal)}/mo × ${payload.selections.monthly_commit_months} = ${money(monthlyTotal * payload.selections.monthly_commit_months)}`
    ]);
  } else if (monthlyTotal > 0) {
    parts.push(["Monthly selected", `${money(monthlyTotal)}/mo (no upfront)`]);
  }

    summaryEl.innerHTML = parts.map(([k, v]) => `
        <div class="summary-item">
        <div class="muted small">${escapeHtml(k)}</div>
        <div>${escapeHtml(v)}</div>
    </div>
    `).join("");

    totalDueEl.textContent = money(total);
}

function buildPayloadForSummary() {
    const fd = new FormData(form);
    const selectedPackage = String(fd.get("package") || "business");

    const addons = [...form.querySelectorAll('input[name="addon"]:checked')].map(i => i.value);
    const monthly = [...form.querySelectorAll('input[name="monthly"]:checked')].map(i => i.value);
    const monthlyCommit = Number(fd.get("commitMonths") || 0);

    return {
    selections: {
        package: selectedPackage,
        addons,
        monthly,
        monthly_commit_months: monthlyCommit
    }
    };
}

function calcTotal(sel) {
    const base = PRICING.base[sel.package]?.cents ?? 0;
    const addons = (sel.addons || []).map(k => PRICING.addons[k]?.cents ?? 0).reduce((a,b)=>a+b,0);

    const monthly = (sel.monthly || []).map(k => PRICING.monthly[k]?.cents ?? 0).reduce((a,b)=>a+b,0);
  const upfront = monthly * (sel.monthly_commit_months || 0);

    return base + addons + upfront;
}

function escapeHtml(s) {
    return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Intersection Observer for "Fade-in" effect
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('active');
    }
  });
}, { threshold: 0.1 });

function initModernUI() {
  document.querySelectorAll('.card, section').forEach(el => {
    el.classList.add('reveal');
    observer.observe(el);
  });
}

// Dynamic High-Quality Image Map for Niches
const nicheContext = {
  "snow": { img: "https://images.unsplash.com/photo-1517204824045-ce0217983c2a?q=80&w=800", alt: "Ottawa residential snow removal service" },
  "medical": { img: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?q=80&w=800", alt: "Modern medical clinic interior" },
  "detailing": { img: "https://images.unsplash.com/photo-1520340356584-f9917d1eea6f?q=80&w=800", alt: "Professional car detailing service" },
  // ... apply to all 10 types
};

document.addEventListener('DOMContentLoaded', initModernUI);

// --- Advanced UI & Portfolio Rendering ---

const demos = [
  { id: "snow", name: "Snow Removal & Lawn", desc: "Includes area map & volume calculator", img: "https://images.unsplash.com/photo-1517204824045-ce0217983c2a?q=80&w=600&auto=format&fit=crop", link: "/demo-snow" },
  { id: "medical", name: "Medical Clinic", desc: "HIPAA-compliant style booking & FAQ", img: "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?q=80&w=600&auto=format&fit=crop", link: "/demo-medical" },
  { id: "detailing", name: "Mobile Detailing", desc: "Before/After gallery & package selector", img: "https://images.unsplash.com/photo-1601362840469-51e4d8d58785?q=80&w=600&auto=format&fit=crop", link: "/demo-detailing" },
  { id: "handyman", name: "Handyman Services", desc: "Dynamic project estimate calculator", img: "https://images.unsplash.com/photo-1581141849291-1125c7b692b5?q=80&w=600&auto=format&fit=crop", link: "/demo-handyman" },
  { id: "bakery", name: "Bakery & Catering", desc: "Visual menu & custom order forms", img: "https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=600&auto=format&fit=crop", link: "/demo-bakery" },
  { id: "braiding", name: "Hair Braiding Studio", desc: "Visual style selector & deposit flow", img: "https://images.unsplash.com/photo-1560014676-127e434f0c86?q=80&w=600&auto=format&fit=crop", link: "/demo-braiding" },
  { id: "tutoring", name: "Tutoring Service", desc: "Subject filters & parent contact portal", img: "https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?q=80&w=600&auto=format&fit=crop", link: "/demo-tutoring" },
  { id: "pet", name: "Mobile Pet Grooming", desc: "Breed size selector & scheduling", img: "https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?q=80&w=600&auto=format&fit=crop", link: "/demo-pet" },
  { id: "chef", name: "Personal Chef", desc: "Dietary preference capture & meal plans", img: "https://images.unsplash.com/photo-1556910103-1c02745aae4d?q=80&w=600&auto=format&fit=crop", link: "/demo-chef" },
  { id: "farm", name: "Farm / CSA Box", desc: "Subscription showcase & delivery zones", img: "https://images.unsplash.com/photo-1464226184884-fa280b87c399?q=80&w=600&auto=format&fit=crop", link: "/demo-farm" }
];

function renderPortfolio() {
  const grid = document.getElementById("portfolioGrid");
  if (!grid) return;

  grid.innerHTML = demos.map(demo => `
    <a href="${demo.link}" class="demo-card">
      <img src="${demo.img}" alt="${demo.name} website template" class="demo-image" loading="lazy" />
      <div class="demo-info">
        <h3 class="demo-title">${demo.name}</h3>
        <div class="demo-desc">${demo.desc}</div>
      </div>
    </a>
  `).join("");
}

// Intersection Observer for the smooth scroll reveals
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// Call these inside your existing init() function at the top of main.js
// renderPortfolio();
// initScrollAnimations();