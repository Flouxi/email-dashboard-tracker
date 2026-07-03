# Manifest — Email Send Tracking

Self-hosted open/click tracking backend + dashboard for your mail sender.
Node/Express, deployable to Vercel, storage in Vercel KV.

## How it works

- Each recipient gets a **signed token** (no database write needed up front) encoding their email + campaign name.
- An **open pixel** URL (`/t/o/TOKEN`) — a 1×1 transparent gif your email HTML loads — logs an "open" event when the recipient's mail client fetches it.
- **Click links** (`/t/c/TOKEN?url=...`) redirect to your real link and log a "click" event first.
- The **dashboard** (`/`) shows sent/opened/clicked totals and a per-recipient table, refreshed from `/api/stats`.

Note on open tracking generally: many mail clients (Gmail, Apple Mail with Mail Privacy Protection, etc.) proxy or block pixel loads, so open rates from any tracking pixel — this one included — are a directional signal, not an exact count.

## 1. Local setup

```bash
npm install
cp .env.example .env
# edit .env: set TRACKING_SECRET and DASHBOARD_SECRET to random strings
npm run dev
```

Visit `http://localhost:3000` — it'll prompt for your `DASHBOARD_SECRET` and store it in the browser. Locally (without KV env vars set) it stores data in `.local-data.json` for testing.

## 2. Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New Project** → import that repo.
3. In the project's **Storage** tab, add a **KV** database and connect it to the project — this auto-sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. In **Settings → Environment Variables**, add:
   - `TRACKING_SECRET` — long random string
   - `DASHBOARD_SECRET` — the password you'll use to view the dashboard
5. Deploy.
6. In **Settings → Domains**, add `n8n.iptvnord4k.com` and point its DNS (CNAME to `cname.vercel-dns.com`, or per Vercel's instructions) at Vercel.

Your tracking base URL is then `https://n8n.iptvnord4k.com`.

## 3. Belkorchi Massmail Pro's built-in tracker (this is the path you'll actually use)

Belkorchi's **Tracking** tab has its own "Setup Tracking" feature. It doesn't support per-recipient merge tags — it generates a fixed PHP snippet that calls one URL with only a bare `?email=...` param, expecting a 1×1 gif back. This server answers that exact contract, no PHP needed:

1. In Belkorchi's **Tracking** tab, set **Tracking URL** to `https://n8n.iptvnord4k.com`, click **Setup Tracking**.
2. Ignore the PHP file/folder instructions in the popup — you don't need to create anything on a separate PHP host.
3. Where Belkorchi asks you to "enter the full URL below once setup," enter:
   ```
   https://n8n.iptvnord4k.com/tracker/track.php
   ```
4. Send your campaign as normal. Every open pings that URL with the recipient's email; you'll see it land on the dashboard's **Belkorchi Opens** view (the default tab).

This only reports *who opened* — Belkorchi's simple pixel doesn't tell the tracker how many were sent, so there's no open-rate % on this view, just counts and timestamps per recipient.

## 4. (Optional) Advanced click tracking via generate-links.js

Belkorchi's built-in tracker only does opens, not link clicks. If you also want click tracking, you'd need Belkorchi to support per-recipient merge tags in the Email Template itself (separate from its Tracking tab) — check its docs for that. If it does, this repo still includes a self-contained token system for that path:

### Generate tracking links for a recipient list

```bash
node scripts/generate-links.js customers_import.csv customers_tracked.csv https://n8n.iptvnord4k.com "july-campaign"
```

This reads a `Name,Email` CSV and writes a new CSV with a `PixelURL` and `ClickWrapPrefix` per row. **Make sure `TRACKING_SECRET` in your local `.env` matches the one set on Vercel**, or tokens generated locally won't verify on the deployed server.

## 4. Wire it into your email template

In Belkorchi Massmail Pro's **Email Template** tab, add near the bottom of the HTML body:

```html
<img src="{{PixelURL}}" width="1" height="1" style="display:none" alt="" />
```

For any link you want click-tracked, wrap the destination:

```
{{ClickWrapPrefix}}https%3A%2F%2Fyour-real-destination.com
```

(the destination must be URL-encoded — the generator script's `ClickWrapPrefix` already ends in `?url=`, so you just append the encoded target).

If Belkorchi supports merge fields from an imported CSV column (check its Email Template docs for the exact `{{column}}` syntax), map `PixelURL` and `ClickWrapPrefix` directly. If it doesn't support per-row merge fields at all, you'd need to send in per-recipient batches or use its API/scripting hook if one exists — check Belkorchi's own documentation for that.

## 5. View results

Go to `https://n8n.iptvnord4k.com`, enter your `DASHBOARD_SECRET`, and watch opens/clicks come in as they happen.

## Project structure

```
api/index.js        # Vercel serverless entrypoint (wraps server.js)
server.js            # Express app: tracking routes + stats API
lib/token.js          # signed token create/verify
lib/store.js          # Vercel KV storage (local JSON fallback for dev)
public/index.html     # dashboard UI
scripts/generate-links.js  # CSV -> per-recipient tracking links
```
