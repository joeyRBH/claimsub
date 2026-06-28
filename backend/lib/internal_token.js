'use strict';

// Short-lived service token for internal server-to-server calls — specifically the
// claims Lambda invoking the Vercel /api/claims/:id/charge-fee function. Signed with
// the shared JWT_SECRET (HS256), bound to a single claim_id, with a 5-minute expiry
// and a distinct `purpose` so it can never be used as a staff/session or payment
// token. This keeps the money-movement endpoint from being callable by anyone who
// merely knows the URL.

const jwt = require('jsonwebtoken');

const ALGORITHM = 'HS256';
const PURPOSE = 'charge_fee';
const EXPIRES_IN = '5m';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

// sign(claimId) -> token string with { claim_id, purpose, iat, exp }.
function sign(claimId) {
  return jwt.sign({ claim_id: claimId, purpose: PURPOSE }, getSecret(), {
    algorithm: ALGORITHM,
    expiresIn: EXPIRES_IN,
  });
}

// verify(token) -> { claim_id } or throws. Rejects any token whose purpose is not
// the charge-fee purpose.
function verify(token) {
  const decoded = jwt.verify(token, getSecret(), { algorithms: [ALGORITHM] });
  if (!decoded || decoded.purpose !== PURPOSE || !decoded.claim_id) {
    throw new Error('Invalid internal token');
  }
  return { claim_id: decoded.claim_id };
}

module.exports = { sign, verify, PURPOSE };
