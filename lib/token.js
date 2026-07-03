// lib/token.js
// Builds and verifies compact, signed tracking tokens.
// A token encodes { e: recipientEmail, c: campaign, s: sentAt } so the
// open/click endpoints can identify the recipient WITHOUT needing a
// database lookup or a "register" call before sending.

const crypto = require('crypto');

const SECRET = process.env.TRACKING_SECRET || 'change-me-in-env';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64').toString('utf8');
}

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 16);
}

/**
 * Create a tracking token for a recipient.
 * @param {string} email - recipient email address
 * @param {string} campaign - campaign/batch name
 * @returns {string} url-safe token
 */
function createToken(email, campaign = 'default') {
  const payload = JSON.stringify({ e: email, c: campaign, s: Date.now() });
  const encoded = base64url(payload);
  const sig = sign(encoded);
  return `${encoded}.${sig}`;
}

/**
 * Verify and decode a tracking token.
 * @param {string} token
 * @returns {{e: string, c: string, s: number} | null}
 */
function verifyToken(token) {
  try {
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) return null;
    if (sign(encoded) !== sig) return null;
    return JSON.parse(base64urlDecode(encoded));
  } catch (err) {
    return null;
  }
}

module.exports = { createToken, verifyToken };
