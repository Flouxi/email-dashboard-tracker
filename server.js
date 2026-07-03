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
