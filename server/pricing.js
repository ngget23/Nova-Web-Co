export const PRICING = {
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

export function calculateTotalCents(selections) {
    const base = PRICING.base[selections.package]?.cents ?? 0;

    const addons = (selections.addons ?? [])
    .map((k) => PRICING.addons[k]?.cents ?? 0)
    .reduce((a, b) => a + b, 0);

    const monthly = (selections.monthly ?? [])
    .map((k) => PRICING.monthly[k]?.cents ?? 0)
    .reduce((a, b) => a + b, 0);

    const monthlyCount = selections.monthly_commit_months ?? 0;
  const monthlyUpfront = monthly * monthlyCount;

    return base + addons + monthlyUpfront;
}

export function formatMoney(cents) {
    return (cents / 100).toFixed(2);
}