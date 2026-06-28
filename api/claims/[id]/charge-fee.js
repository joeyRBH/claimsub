'use strict';

// POST /api/claims/:id/charge-fee — INTERNAL Vercel serverless function.
//
// Invoked server-to-server by the claims Lambda right after a successful Stedi
// submission (the Lambda is in a VPC with no Stripe egress). This runs on Vercel
// where it has outbound internet to Stripe, and reaches Postgres via DATABASE_URL.
// It charges the patient the per-claim platform fee off-session and records a
// transactions row.
//
// Auth: a short-lived internal token (lib/internal_token) signed with JWT_SECRET and
// bound to this claim_id — NOT a staff/session token. Idempotent: if a paid
// platform_fee already exists for the claim, it returns without charging again.
// Never throws to the caller in a way that would imply the claim failed; the Lambda
// treats any error here as best-effort. Never logs PHI.

const db = require('../../../backend/lib/db');
const stripe = require('../../../backend/lib/stripe');
const internalToken = require('../../../backend/lib/internal_token');

function bearer(req) {
  const raw = req.headers.authorization || req.headers.Authorization;
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return m ? m[1].trim() : null;
}

async function loadClaim(claimId) {
  const r = await db.query(`select * from claims where id = $1 and is_hidden = false limit 1`, [claimId]);
  return r.rows[0] || null;
}

async function loadClient(clientId) {
  const r = await db.query(`select * from clients where id = $1 limit 1`, [clientId]);
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

  // Authenticate the internal call and bind it to the claim in the path.
  const claimIdFromPath = req.query && req.query.id;
  try {
    const { claim_id } = internalToken.verify(bearer(req));
    if (!claimIdFromPath || claim_id !== claimIdFromPath) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } catch (_) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const claim = await loadClaim(claimIdFromPath);
    if (!claim) return res.status(404).json({ error: 'Not found' });

    // Idempotency: never double-charge if the Lambda retries.
    if (await alreadyCharged(claim.id)) {
      return res.status(200).json({ ok: true, charged: false, reason: 'already_charged' });
    }

    const client = await loadClient(claim.client_id);
    const practice = await loadPractice(claim.practice_id);
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
