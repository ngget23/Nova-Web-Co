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