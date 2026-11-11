// Magic-link tokens for the referring-vet portal.
//
// Unlike the HMAC confirm/cancel/reschedule links in reminders.js (deterministic,
// no expiry, no revocation — fine for a one-off appointment action), a referral
// case token is the ONLY credential an external vet has to reach a patient's live
// clinical record, potentially for months. It must be truly random, revocable and
// expirable, so it's a separate, DB-backed mechanism: random bytes go out in the
// email URL and are never stored; only a SHA-256 hash is kept, looked up by
// indexed equality (there's no shared secret to protect, so no constant-time
// comparison is needed here, unlike an HMAC verification).
const crypto = require('crypto');

const DEFAULT_TTL_DAYS = 365;

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Issues a new token for a case and returns the RAW value (caller must only
// ever place this in an emailed URL — never log it or return it from an API).
function issueReferralToken(db, caseId, { settings = {}, createdReason = 'initial' } = {}) {
  const ttlDays = parseInt(settings.referralTokenTtlDays, 10) || DEFAULT_TTL_DAYS;
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  db.createReferralToken(caseId, hashToken(token), { expiresAt, createdReason });
  return token;
}

// Resolves a raw token from a request into its DB row (case-bearing), or null.
function resolveReferralToken(db, rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const row = db.getReferralTokenByHash(hashToken(rawToken));
  if (!row) return null;
  db.touchReferralToken(row.id);
  return row;
}

module.exports = { generateToken, hashToken, issueReferralToken, resolveReferralToken, DEFAULT_TTL_DAYS };
