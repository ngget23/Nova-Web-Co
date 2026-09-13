# Nova Web Co

Marketing site and order system for a local-business web design studio.
When someone leaves their details, **it texts you**.

- `client/` — the public site (static, built with Vite)
- `server/` — Express API: lead capture, SMS alerts, Stripe checkout

---

## Text alerts (the important part)

Three things send a text to your phone:

| Trigger | Text you get |
| --- | --- |
| Someone submits the contact form | `New lead - Nova Web Co` + name, business, phone, email, what they want, their message |
| Someone reaches Stripe checkout | `Checkout started` + who they are and the total |
| A payment succeeds | `PAID ORDER` + who and how much |

### Setting it up

1. Make a [Twilio](https://console.twilio.com) account and buy a phone number
   (a few dollars a month).
2. Copy `server/.env.example` to `server/.env` and fill in:

   ```
   TWILIO_ACCOUNT_SID=AC...        # Twilio console dashboard
   TWILIO_AUTH_TOKEN=...           # same page
   TWILIO_FROM_NUMBER=+16135550123 # the number you bought
   ALERT_SMS_TO=+16135559876       # YOUR phone - where texts land
   ```

3. Restart the server. On boot it prints `Text alerts: enabled`, and
   `GET /api/health` returns `{"ok":true,"sms":true}`.

To alert more than one phone, comma-separate them:
`ALERT_SMS_TO=+16135559876,+16135551111`

**If Twilio isn't configured**, nothing breaks — the lead is still saved and the
visitor still sees a confirmation. You just don't get the text. The same is true
if Twilio is down or rejects the message: the lead is never lost to a failed alert.

---

## Running locally

```bash
# API
cd server && npm install && npm run dev      # http://localhost:3000

# Site
cd client && npm install && npm run dev      # http://localhost:5173
```

The front end points at `localhost:3000` automatically when you're on localhost,
and at the deployed API otherwise (see `API` at the top of `client/main.js`).

```bash
cd client && npm run build                   # → client/dist
```

---

## Environment variables

Everything lives in `server/.env` — see `server/.env.example` for the full list.

| Variable | Needed for | Notes |
| --- | --- | --- |
| `PORT` | server | Defaults to `3000` |
| `CLIENT_ORIGIN` | CORS | Comma-separate to allow apex + `www` + previews. Localhost is always allowed. Unset = allow all, with a warning |
| `TWILIO_*`, `ALERT_SMS_TO` | text alerts | See above |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | checkout | |
| `SUCCESS_URL`, `CANCEL_URL` | checkout | Where Stripe returns people |
| `EMAIL_*`, `ORDER_RECEIVER_EMAIL` | optional | Emailed backup copy of every lead and order |

---

## API

| Route | What it does |
| --- | --- |
| `GET /api/health` | `{ ok, sms }` — quick check that text alerts are configured |
| `GET /api/pricing` | Packages, add-ons and monthly rates |
| `POST /api/lead` | Contact form. Saves the lead, texts you, emails a copy |
| `POST /api/create-checkout-session` | Builds a Stripe Checkout session |
| `POST /api/webhook` | Stripe webhook — marks the order paid and texts you |

`POST /api/lead` takes `name` (required) plus at least one of `phone` or
`email`, and optionally `business`, `service`, `message`. It's protected by a
hidden honeypot field and a 5-per-10-minutes-per-IP throttle so nobody can flood
your phone.

### Leads on disk

Leads are appended to `server/leads.json` (and orders to `server/orders.json`).
Both are gitignored. On an ephemeral host like Render's free tier these are
wiped on each deploy — the text message is the durable record, not the file. If
you want leads kept permanently, point them at a database.
