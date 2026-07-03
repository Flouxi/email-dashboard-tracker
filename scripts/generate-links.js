// scripts/generate-links.js
//
// Reads a CSV with "Name,Email" columns and produces a new CSV with a
// unique, self-contained tracking token + pixel URL per recipient, so you
// can merge them into your email template before sending.
//
// Usage:
//   TRACKING_SECRET=your-secret node scripts/generate-links.js \
//     input.csv output.csv https://n8n.iptvnord4k.com "campaign-name"
//
// IMPORTANT: TRACKING_SECRET here must match the TRACKING_SECRET set on
// your deployed server (Vercel env var), otherwise tokens won't verify.

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { createToken } = require('../lib/token');

const [, , inputPath, outputPath, baseUrlArg, campaignArg] = process.argv;

if (!inputPath || !outputPath || !baseUrlArg) {
  console.error(
    'Usage: node scripts/generate-links.js <input.csv> <output.csv> <baseUrl> [campaign]'
  );
  process.exit(1);
}

const baseUrl = baseUrlArg.replace(/\/$/, '');
const campaign = campaignArg || 'default';

const raw = fs.readFileSync(path.resolve(inputPath), 'utf8');
const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

// naive CSV parse assuming no embedded commas in Name/Email (matches our export)
const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
const nameIdx = header.indexOf('name');
const emailIdx = header.indexOf('email');

if (nameIdx === -1 || emailIdx === -1) {
  console.error('Input CSV must have "Name" and "Email" columns.');
  process.exit(1);
}

const outRows = ['Name,Email,PixelURL,ClickWrapPrefix'];

for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(',');
  const name = (cols[nameIdx] || '').trim();
  const email = (cols[emailIdx] || '').trim();
  if (!name || !email) continue;

  const token = createToken(email, campaign);
  const pixelUrl = `${baseUrl}/t/o/${token}`;
  // to wrap a link: `${baseUrl}/t/c/${token}?url=` + encodeURIComponent(targetUrl)
  const clickWrapPrefix = `${baseUrl}/t/c/${token}?url=`;

  outRows.push(`${name},${email},${pixelUrl},${clickWrapPrefix}`);
}

fs.writeFileSync(path.resolve(outputPath), outRows.join('\n'));
console.log(`Wrote ${outRows.length - 1} rows to ${outputPath}`);
