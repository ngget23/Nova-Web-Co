/**
 * Lead capture: validation, throttling and a JSON file store.
 *
 * Note: the file store mirrors how orders are persisted today. On an
 * ephemeral host (Render free tier) it survives only until the next deploy,
 * so the text message is the durable notification, not this file.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADS_PATH = path.join(__dirname, "leads.json");

const MAX = { name: 120, business: 160, email: 200, phone: 40, service: 80, message: 2000 };

export function readLeads() {
  if (!fs.existsSync(LEADS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(LEADS_PATH, "utf8"));
  } catch {
    return [];
  }
}

export function writeLeads(leads) {
  fs.writeFileSync(LEADS_PATH, JSON.stringify(leads, null, 2));
}

export function saveLead(lead) {
  const leads = readLeads();
  leads.push(lead);
  writeLeads(leads);
  return leads.length;
}

/**
 * Returns { ok: true, lead } or { ok: false, error }.
 * Requires a name plus at least one way to reach them back.
 */
export function validateLead(body) {
  const clean = (v, max) => String(v ?? "").trim().slice(0, max);

  const lead = {
    name: clean(body?.name, MAX.name),
    business: clean(body?.business, MAX.business),
    email: clean(body?.email, MAX.email),
    phone: clean(body?.phone, MAX.phone),
    service: clean(body?.service, MAX.service),
    message: clean(body?.message, MAX.message),
    source: clean(body?.source, 60) || "website"
  };

  if (!lead.name) return { ok: false, error: "Please tell us your name." };
  if (!lead.phone && !lead.email) {
    return { ok: false, error: "Add a phone number or an email so we can reply." };
  }
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) {
    return { ok: false, error: "That email address doesn't look right." };
  }
  if (lead.phone && countDigits(lead.phone) < 10) {
    return { ok: false, error: "That phone number doesn't look right." };
  }

  return { ok: true, lead };
}

function countDigits(s) {
  return (String(s).match(/\d/g) || []).length;
}

/**
 * Small in-memory throttle so one visitor (or a bot) cannot flood the phone.
 * Resets when the process restarts, which is fine for this volume.
 */
const hits = new Map();

export function rateLimit(key, { max = 5, windowMs = 10 * 60 * 1000 } = {}) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs);

  if (recent.length >= max) {
    hits.set(key, recent);
    return { allowed: false, retryAfterMs: windowMs - (now - recent[0]) };
  }

  recent.push(now);
  hits.set(key, recent);

  // Keep the map from growing without bound on a long-lived process.
  if (hits.size > 5000) {
    for (const [k, times] of hits) {
      if (times.every(t => now - t >= windowMs)) hits.delete(k);
    }
  }

  return { allowed: true };
}

/** The text you actually receive on your phone. */
export function formatLeadSms(lead) {
  const lines = [`New lead - Nova Web Co`, ``, lead.name];

  if (lead.business) lines.push(lead.business);
  if (lead.phone) lines.push(`Ph: ${lead.phone}`);
  if (lead.email) lines.push(`Em: ${lead.email}`);
  if (lead.service) lines.push(`Wants: ${lead.service}`);
  if (lead.message) lines.push(``, `"${lead.message}"`);

  return lines.join("\n");
}
