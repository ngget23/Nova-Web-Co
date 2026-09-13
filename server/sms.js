/**
 * Twilio SMS alerts.
 *
 * Uses the Twilio REST API directly over fetch (Node 18+) so the server needs
 * no extra dependency and the build cannot break on a missing package.
 *
 * Required env vars (see .env.example):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, ALERT_SMS_TO
 *
 * If any are missing, sendSms() logs and returns { skipped: true } instead of
 * throwing, so a misconfigured phone alert never costs you the lead itself.
 */

export function smsConfigured(env = process.env) {
  return Boolean(
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_FROM_NUMBER &&
    env.ALERT_SMS_TO
  );
}

/** ALERT_SMS_TO may hold several numbers, comma separated. */
function recipients(env) {
  return String(env.ALERT_SMS_TO || "")
    .split(",")
    .map(n => n.trim())
    .filter(Boolean);
}

export async function sendSms(body, env = process.env) {
  if (!smsConfigured(env)) {
    console.warn("[sms] Twilio not configured - skipping text alert.");
    return { skipped: true };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`;
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");

  const results = [];

  for (const to of recipients(env)) {
    const params = new URLSearchParams({
      To: to,
      From: env.TWILIO_FROM_NUMBER,
      // Twilio hard-caps a single message; trim so long notes don't 400.
      Body: truncate(body, 1500)
    });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error(`[sms] Twilio rejected message to ${to}:`, data?.message || res.status);
        results.push({ to, ok: false, error: data?.message || String(res.status) });
      } else {
        console.log(`[sms] Sent ${data.sid} to ${to}`);
        results.push({ to, ok: true, sid: data.sid });
      }
    } catch (err) {
      console.error(`[sms] Network error texting ${to}:`, err?.message || err);
      results.push({ to, ok: false, error: String(err?.message || err) });
    }
  }

  return { skipped: false, results };
}

function truncate(s, max) {
  const str = String(s ?? "");
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}
