// server.js
// Express app. Exported so it can run both:
//  - locally / on a VPS via `node server.js` (app.listen)
//  - on Vercel via api/index.js, which imports this same app

require('dotenv').config();
const express = require('express');
const path = require('path');
const { createToken, verifyToken } = require('./lib/token');
const store = require('./lib/store');

const app = express();
app.use(express.json());

const DASHBOARD_KEY = process.env.DASHBOARD_SECRET || null;

// 1x1 transparent GIF, served by the open-tracking pixel
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
  'base64'
);

function requireKey(req, res, next) {
  if (!DASHBOARD_KEY) return next(); // no key configured -> open (set one before going live!)
  const key = req.query.key || req.headers['x-api-key'];
  if (key !== DASHBOARD_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ---- Tracking endpoints (public, no auth — these are hit by mail clients) ----

// Open tracking pixel: <img src="https://yourdomain/t/o/TOKEN">
app.get('/t/o/:token', async (req, res) => {
  const decoded = verifyToken(req.params.token);
  if (decoded) {
    try {
      await store.logEvent(req.params.token, decoded, 'open');
    } catch (err) {
      console.error('open tracking error', err);
    }
  }
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.send(PIXEL);
});

// Click tracking redirect: <a href="https://yourdomain/t/c/TOKEN?url=ENCODED_TARGET">
app.get('/t/c/:token', async (req, res) => {
  const decoded = verifyToken(req.params.token);
  const target = req.query.url ? decodeURIComponent(req.query.url) : null;
  if (decoded) {
    try {
      await store.logEvent(req.params.token, decoded, 'click', { url: target });
    } catch (err) {
      console.error('click tracking error', err);
    }
  }
  if (target && /^https?:\/\//i.test(target)) {
    return res.redirect(302, target);
  }
  res.status(400).send('Missing or invalid redirect url');
});

// ---- Belkorchi Massmail Pro's built-in tracker ----
// Belkorchi's "Setup Tracking" feature generates its own pixel code and
// calls a FIXED url with only a bare `email` query param — no token, no
// campaign, no click tracking. This route matches that exact contract.
// Enter this full URL in Belkorchi's "Tracking URL" field:
//   https://n8n.iptvnord4k.com/tracker/track.php
app.get('/tracker/track.php', async (req, res) => {
  const email = req.query.email;
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  // Vercel's edge network sets this automatically on every request — no
  // external geo-IP service needed. Locally it'll just be 'Unknown'.
  const country = req.headers['x-vercel-ip-country'] || 'Unknown';
  const userAgent = req.headers['user-agent'] || 'Unknown';

  if (email) {
    try {
      await store.logRawOpen(email, { ip, country, userAgent });
    } catch (err) {
      console.error('belkorchi open tracking error', err);
    }
  }
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.send(PIXEL);
});

app.get('/api/opens', requireKey, async (req, res) => {
  const all = await store.getRawOpens();
  const totalOpenEvents = all.reduce((n, r) => n + r.opens.length, 0);

  res.json({
    summary: {
      totalRecipientsOpened: all.length,
      totalOpenEvents,
    },
    records: all.map((r) => ({
      email: r.email,
      openCount: r.opens.length,
      firstOpenAt: r.opens[0]?.at || null,
      lastOpenAt: r.opens[r.opens.length - 1]?.at || null,
      ips: [...new Set(r.opens.map((o) => o.ip))],
    })),
  });
});

// Full dashboard: totals, hourly chart, top countries, top domains, recent log
app.get('/api/dashboard', requireKey, async (req, res) => {
  const events = await store.getFlattenedLog();

  const totalOpens = events.length;
  const uniqueIps = new Set(events.map((e) => e.ip)).size;
  const uniqueEmails = new Set(events.map((e) => e.email)).size;

  // hourly buckets for today (local server time / UTC)
  const hourly = Array.from({ length: 24 }, (_, h) => ({
    hour: String(h).padStart(2, '0') + ':00',
    count: 0,
  }));
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const e of events) {
    if (e.at.slice(0, 10) === todayStr) {
      const h = new Date(e.at).getUTCHours();
      hourly[h].count += 1;
    }
  }

  const countryCounts = {};
  const domainCounts = {};
  for (const e of events) {
    countryCounts[e.country] = (countryCounts[e.country] || 0) + 1;
    const domain = (e.email.split('@')[1] || 'unknown').toLowerCase();
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  }
  const topCountries = Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([country, count]) => ({ country, count }));
  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));

  const mostRecent = events[0]?.at || null;
  const recentActive = mostRecent && Date.now() - new Date(mostRecent).getTime() < 30 * 60 * 1000;

  res.json({
    summary: { totalOpens, uniqueIps, uniqueEmails, recentActive, lastEventAt: mostRecent },
    hourly,
    topCountries,
    topDomains,
    logs: events.slice(0, 500),
  });
});

// Filterable logs (email / country substring match)
app.get('/api/logs', requireKey, async (req, res) => {
  const events = await store.getFlattenedLog();
  const { email, country } = req.query;
  let filtered = events;
  if (email) filtered = filtered.filter((e) => e.email.toLowerCase().includes(String(email).toLowerCase()));
  if (country) filtered = filtered.filter((e) => e.country.toLowerCase().includes(String(country).toLowerCase()));
  res.json({ logs: filtered });
});

// CSV export of all logs
app.get('/api/logs/export', requireKey, async (req, res) => {
  const events = await store.getFlattenedLog();
  const rows = ['Time,IP Address,Country,Email,User Agent'];
  for (const e of events) {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    rows.push([esc(e.at), esc(e.ip), esc(e.country), esc(e.email), esc(e.userAgent)].join(','));
  }
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="tracking-logs.csv"');
  res.send(rows.join('\n'));
});

// Delete all raw tracking logs
app.delete('/api/logs', requireKey, async (req, res) => {
  await store.clearAll();
  res.json({ ok: true });
});

// ---- API: generate tracking links for a recipient (used by generate-links script) ----
app.post('/api/token', requireKey, (req, res) => {
  const { email, campaign } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  const token = createToken(email, campaign || 'default');
  res.json({ token });
});

// ---- API: dashboard data ----
app.get('/api/stats', requireKey, async (req, res) => {
  const all = await store.getAll();

  const campaign = req.query.campaign;
  const filtered = campaign ? all.filter((r) => r.campaign === campaign) : all;

  const totalSent = filtered.length;
  const totalOpened = filtered.filter((r) => r.opens.length > 0).length;
  const totalClicked = filtered.filter((r) => r.clicks.length > 0).length;
  const totalOpenEvents = filtered.reduce((n, r) => n + r.opens.length, 0);
  const totalClickEvents = filtered.reduce((n, r) => n + r.clicks.length, 0);

  const campaigns = [...new Set(all.map((r) => r.campaign))];

  res.json({
    summary: {
      totalSent,
      totalOpened,
      totalClicked,
      openRate: totalSent ? +((totalOpened / totalSent) * 100).toFixed(1) : 0,
      clickRate: totalSent ? +((totalClicked / totalSent) * 100).toFixed(1) : 0,
      totalOpenEvents,
      totalClickEvents,
    },
    campaigns,
    records: filtered
      .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
      .map((r) => ({
        token: r.token,
        email: r.email,
        campaign: r.campaign,
        sentAt: r.sentAt,
        opened: r.opens.length > 0,
        openCount: r.opens.length,
        firstOpenAt: r.opens[0] || null,
        lastOpenAt: r.opens[r.opens.length - 1] || null,
        clicked: r.clicks.length > 0,
        clickCount: r.clicks.length,
        clickedUrls: r.clicks.map((c) => c.url),
      })),
  });
});

app.get('/api/stats/:token', requireKey, async (req, res) => {
  const record = await store.getOne(req.params.token);
  if (!record) return res.status(404).json({ error: 'not found' });
  res.json(record);
});

// ---- Dashboard static site ----
app.use(express.static(path.join(__dirname, 'public')));

module.exports = app;

// Only listen directly when run standalone (local dev / VPS).
// On Vercel, api/index.js imports `app` and Vercel handles the listening.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Tracking server running on port ${PORT}`));
}
