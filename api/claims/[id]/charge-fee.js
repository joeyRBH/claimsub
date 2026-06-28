'use strict';

// POST /api/claims/:id/charge-fee — Vercel serverless function, STAFF JWT-authenticated.
//
// Triggered by the frontend right after a successful claim submission (the claims
// Lambda has no Stripe egress, so the charge can't happen there). The browser already
// holds the staff session JWT and forwards it here as a Bearer token; this function
// verifies it with JWT_SECRET (same lib/auth as the Lambda handlers), scopes the claim
// to the caller's practice, then charges the patient's saved card off-session and
// records a transactions row.
//
// Best-effort by design: the claim is already submitted, so the frontend ignores the
// result. Idempotent — if a paid platform_fee already exists for the claim, it returns
// without charging again. Never logs PHI.

const db = require('../../../backend/lib/db');
const stripe = require('../../../backend/lib/stripe');
const { requireAuth } = require('../../../backend/lib/auth');

async function loadPracticeId(userId) {
  const r = await db.query(
    `select practice_id from users where id = $1 and is_active = true limit 1`,
    [userId]
  );
  return r.rows[0] ? r.rows[0].practice_id : null;
}

// Claim scoped to the caller's practice (cross-practice / missing → null).
async function loadClaim(practiceId, claimId) {
  const r = await db.query(
    `select * from claims where id = $1 and practice_id = $2 and is_hidden = false limit 1`,
    [claimId, practiceId]
  );
  return r.rows[0] || null;
}

async function loadClient(practiceId, clientId) {
  const r = await db.query(
    `select * from clients where id = $1 and practice_id = $2 limit 1`,
    [clientId, practiceId]
  );
  return r.rows[0] || null;
}

async function loadPractice(practiceId) {
  const r = await db.query(`select * from practices where id = $1 limit 1`, [practiceId]);
  return r.rows[0] || null;
}

// True if we've already recorded a successful platform fee for this claim.
async function alreadyCharged(claimId) {
  const r = await db.query(
    `select 1 from transactions
      where claim_id = $1 and type = 'platform_fee' and status = 'paid' limit 1`,
    [claimId]
  );
  return r.rowCount > 0;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Authenticate the staff session JWT (forwarded from the browser).
  let auth;
  try {
    auth = requireAuth({ headers: req.headers });
  } catch (_) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const practiceId = await loadPracticeId(auth.user.sub);
    if (!practiceId) return res.status(401).json({ error: 'Unauthorized' });

    const claimId = req.query && req.query.id;
    if (!claimId) return res.status(404).json({ error: 'Not found' });

    const claim = await loadClaim(practiceId, claimId);
    if (!claim) return res.status(404).json({ error: 'Not found' });

    // Idempotency: never double-charge if the frontend retries.
    if (await alreadyCharged(claim.id)) {
      return res.status(200).json({ ok: true, charged: false, reason: 'already_charged' });
    }

    const client = await loadClient(practiceId, claim.client_id);
    const practice = await loadPractice(practiceId);
    if (!client || !practice) return res.status(404).json({ error: 'Not found' });

    // No card on file → skip the fee silently (the claim still stands).
    if (!client.payment_method_id || !client.stripe_customer_id) {
      return res.status(200).json({ ok: true, charged: false, reason: 'no_payment_method' });
    }

    const percent = Number(practice.platform_fee_percent);
    const billed = Number(claim.billed_amount);
    if (!Number.isFinite(percent) || percent <= 0 || !Number.isFinite(billed) || billed <= 0) {
      return res.status(200).json({ ok: true, charged: false, reason: 'nothing_to_charge' });
    }

    const feeAmountCents = Math.round(billed * (percent / 100) * 100);
    if (feeAmountCents <= 0) {
      return res.status(200).json({ ok: true, charged: false, reason: 'nothing_to_charge' });
    }
    const feeDollars = feeAmountCents / 100;
    const description = `Platform fee (${percent}%) for claim ${claim.id}`;

    let intent = null;
    let chargeError = null;
    try {
      intent = await stripe.createPaymentIntent({
        amount: feeAmountCents,
        currency: 'usd',
        customer: client.stripe_customer_id,
        payment_method: client.payment_method_id,
        confirm: true,
        off_session: true,
        description: `Reddably platform fee — claim ${claim.id}`,
        metadata: { claim_id: claim.id, client_id: client.id, practice_id: practice.id },
      });
    } catch (err) {
      chargeError = (err && err.message) || 'Fee charge failed';
      console.error('charge_fee (stripe) error:', chargeError);
    }

    const chargeId =
      intent && (typeof intent.latest_charge === 'string'
        ? intent.latest_charge
        : (intent.charges && intent.charges.data && intent.charges.data[0] && intent.charges.data[0].id)) || null;

    try {
      await db.query(
        `insert into transactions
           (practice_id, client_id, claim_id, type, description, amount, currency, fee_payer,
            stripe_payment_intent_id, stripe_charge_id, status)
         values ($1, $2, $3, 'platform_fee', $4, $5, 'usd', 'client', $6, $7, $8)`,
        [
          practice.id,
          client.id,
          claim.id,
          description,
          feeDollars,
          intent ? intent.id : null,
          chargeId,
          chargeError ? 'failed' : 'paid',
        ]
      );
    } catch (txErr) {
      console.error('charge_fee (transaction insert) error:', txErr && txErr.message);
    }

    if (chargeError) {
      return res.status(200).json({ ok: false, charged: false, fee_charge_error: chargeError });
    }
    return res.status(200).json({ ok: true, charged: true, amount: feeDollars });
  } catch (err) {
    console.error('charge_fee error:', err && err.message);
    return res.status(500).json({ error: 'Could not charge platform fee.' });
  }
};
