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

// Booking window offered on the form: business hours, up to a year out.
const SLOT_START_MIN = 8 * 60;   // 08:00
const SLOT_END_MIN = 19 * 60;    // 19:00
const MAX_DAYS_AHEAD = 365;

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
    preferred_date: clean(body?.preferred_date, 10),
    preferred_time: clean(body?.preferred_time, 5),
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

  const when = validateWhen(lead.preferred_date, lead.preferred_time);
  if (!when.ok) return when;

  return { ok: true, lead };
}

/**
 * Checks the requested date and time.
 *
 * Dates arrive as plain YYYY-MM-DD strings in the visitor's own timezone, so
 * they are compared as strings against the server's date rather than parsed
 * into Date objects - `new Date("2026-09-15")` is UTC midnight and would shift
 * a day on any server west of Greenwich. A one-day grace either side absorbs
 * the offset between a UTC server and a visitor booking late in the evening.
 */
export function validateWhen(date, time) {
  if (!date) return { ok: false, error: "Pick a day that suits you." };
  if (!time) return { ok: false, error: "Pick a time that suits you." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "That date doesn't look right." };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return { ok: false, error: "That time doesn't look right." };
  }

  const [y, m, d] = date.split("-").map(Number);
  // Rejects things like 2026-02-30 that match the pattern but aren't real days.
  const asUtc = new Date(Date.UTC(y, m - 1, d));
  if (asUtc.getUTCFullYear() !== y || asUtc.getUTCMonth() !== m - 1 || asUtc.getUTCDate() !== d) {
    return { ok: false, error: "That date doesn't exist." };
  }

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const daysOut = Math.round((asUtc.getTime() - todayUtc) / dayMs);

  if (daysOut < -1) return { ok: false, error: "That date has already passed." };
  if (daysOut > MAX_DAYS_AHEAD) return { ok: false, error: "Please pick a date within the next year." };

  const [hh, mm] = time.split(":").map(Number);
  const minutes = hh * 60 + mm;
  if (minutes < SLOT_START_MIN || minutes > SLOT_END_MIN) {
    return { ok: false, error: "Please pick a time between 8:00 AM and 7:00 PM." };
  }

  return { ok: true };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue Sep 15, 2:30 PM" - built from the parts so no timezone can shift it. */
export function formatWhen(date, time) {
  if (!date || !time) return "";

  const [y, m, d] = date.split("-").map(Number);
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

  const [hh, mm] = time.split(":").map(Number);
  const suffix = hh >= 12 ? "PM" : "AM";
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;

  return `${weekday} ${MONTHS[m - 1]} ${d}, ${hour12}:${String(mm).padStart(2, "0")} ${suffix}`;
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

  const when = formatWhen(lead.preferred_date, lead.preferred_time);
  if (when) lines.push(`When: ${when}`);

  if (lead.message) lines.push(``, `"${lead.message}"`);

  return lines.join("\n");
}
