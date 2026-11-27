// PAYOUT KYC (client answers W3 / Q5, Q23): identity check before money leaves BibleNestra.
// Used by BOTH Fund Me beneficiaries (lib/fundmeMoney.js payouts) and gift-earnings withdrawals (lib/virtualGifts.js).
//
// The member submits: ID type (BVN, NIN or another national ID), the ID number, their legal name and bank details.
//   • the bank's own account name comes from Paystack resolve-account (GET /bank/resolve) when keys exist; without keys
//     the member types it and staff check it (name_resolved = false);
//   • the legal name must fuzzy-match that account name (namesMatch below), otherwise the submission is refused;
//   • ID and account numbers are AES-GCM encrypted with the same key as Fund Me bank details (FUNDME_DATA_KEY, fallback);
//   • every submission goes to staff (pending_review); staff approve or reject (Admin › Donations & payouts › KYC).
// requireApprovedKyc(env, userId) is the guard: payouts / withdrawals are approved only for status 'approved'.
// Submitting KYC also keeps the Fund Me payout account in step (same bank), and approving KYC verifies that account when
// it is the same one, so a beneficiary fills in one form.
// ID check (lib/dojah.js): for a BVN or NIN, when Dojah is configured, the ID record is looked up and its name (first,
// middle, last) must fuzzy-match BOTH the legal name and the bank account name (namesMatch), else the submission is
// refused (ID_NAME_MISMATCH; the record's name is never shown or stored). A match stores id_verified + provider + a
// masked note. Dojah not configured, national_id, or a Dojah error → 'not_checked' and the usual manual staff review.
// Staff still approve every KYC; the admin KYC review shows the ID check result.
import { q, one } from './db.js';
import { ApiError, bad } from './http.js';
import { paystackConfigured, resolveAccount } from './paystack.js';
import { dojahConfigured, lookupId, fullName } from './dojah.js';
import { encryptField, decryptField, bankList, saveBankAccount } from './fundmeMoney.js';

export const KYC_ID_TYPES = { bvn: 'BVN (Bank Verification Number)', nin: 'NIN (National Identification Number)', national_id: 'Other national ID' };
export const KYC_LABEL = { none: 'Not submitted', pending_review: 'Being checked', approved: 'Approved', rejected: 'Not approved — please resubmit' };
export const ID_CHECK_LABEL = { matched: 'ID record matches (Dojah)', not_checked: 'Not checked automatically — check the ID by hand' };

// ─── name matching ────────────────────────────────────────────────────────────────────────────────────────────────
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'chief', 'alhaji', 'alhaja', 'pastor', 'rev', 'revd', 'engr', 'sir', 'madam', 'mallam', 'barr', 'hon']);
/** "SMITH, John-Paul A." → ['smith', 'john', 'paul'] (lower case, no accents / punctuation / titles / initials). */
export function nameTokens(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((w) => w.length > 1 && !TITLES.has(w));
}
/**
 * Same person? Same words in any order, ignoring case, punctuation, titles, initials and middle names:
 *   • at least two words in common (a first name and a surname), and
 *   • every word of the shorter name is in the longer one ("John Smith" ~ "SMITH JOHN PETER"), or — when both names
 *     have three or more words — each has at most one word the other lacks (different middle names).
 */
export function namesMatch(a, b) {
  const A = [...new Set(nameTokens(a))]; const B = [...new Set(nameTokens(b))];
  if (A.length < 2 || B.length < 2) return false;
  const common = A.filter((w) => B.includes(w)).length;
  if (common < 2) return false;
  if (common === Math.min(A.length, B.length)) return true;
  return A.length >= 3 && B.length >= 3 && A.length - common <= 1 && B.length - common <= 1;
}

// ─── shapes ───────────────────────────────────────────────────────────────────────────────────────────────────────
const iso = (d) => (d ? new Date(d).toISOString() : null);
export function kycShape(k, { admin = false } = {}) {
  if (!k) return { status: 'none', statusLabel: KYC_LABEL.none, approved: false };
  return {
    status: k.status, statusLabel: KYC_LABEL[k.status] || k.status, approved: k.status === 'approved',
    idType: k.id_type, idTypeLabel: KYC_ID_TYPES[k.id_type] || k.id_type, idNumberMasked: `•••• ${k.id_last4}`,
    legalName: k.legal_name, bankCode: k.bank_code, bankName: k.bank_name, accountNumberMasked: `•••• ${k.account_last4}`, last4: k.account_last4,
    accountName: k.account_name, nameResolved: !!k.name_resolved, nameMatch: !!k.name_match, reviewNote: k.review_note || null,
    submittedAt: iso(k.submitted_at), reviewedAt: iso(k.reviewed_at), idVerified: !!k.id_verified,
    ...(admin ? { userId: k.user_id, idCountry: k.id_country, reviewedBy: k.reviewed_by || null,
      idCheck: { status: k.id_check_status || 'not_checked', label: ID_CHECK_LABEL[k.id_check_status || 'not_checked'], provider: k.id_check_provider || null, verified: !!k.id_verified, note: k.id_check_note || null, checkedAt: iso(k.id_checked_at) } } : {}),
  };
}
export const getKyc = (env, userId) => one(env, 'SELECT * FROM payout_kyc WHERE user_id = $1', [userId]);

// ─── the guard ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Throws 409 KYC_REQUIRED unless the member's payout KYC is approved. Returns the KYC row. */
export async function requireApprovedKyc(env, userId) {
  const k = userId ? await getKyc(env, userId) : null;
  if (!k || k.status !== 'approved') {
    const e = new ApiError(409, 'KYC_REQUIRED', !k
      ? 'Identity check needed: the member hasn’t submitted payout KYC (ID and bank details) yet.'
      : k.status === 'rejected' ? 'Identity check (KYC) was not approved — the member must resubmit it.' : 'Identity check (KYC) is still being reviewed — approve it first.');
    e.details = { kycStatus: k ? k.status : 'none', screen: 'PayoutKyc' };
    throw e;
  }
  return k;
}

// ─── member submits ───────────────────────────────────────────────────────────────────────────────────────────────
function parseId(type, raw) {
  const v = String(raw || '').replace(/[\s-]+/g, '').toUpperCase();
  if (type === 'bvn' && !/^[0-9]{11}$/.test(v)) throw bad('A BVN is 11 digits', 'BAD_ID_NUMBER');
  if (type === 'nin' && !/^[0-9]{11}$/.test(v)) throw bad('A NIN is 11 digits', 'BAD_ID_NUMBER');
  if (type === 'national_id' && !/^[A-Z0-9]{4,30}$/.test(v)) throw bad('Enter your ID number (4–30 letters or digits)', 'BAD_ID_NUMBER');
  return v;
}

/** Save (or replace) the member's KYC → pending_review. Refused when the bank's account name doesn't match the legal name. */
export async function submitKyc(c, me, b = {}) {
  const env = c.env;
  const idType = String(b.idType || '').toLowerCase();
  if (!KYC_ID_TYPES[idType]) throw bad('Choose an ID type: BVN, NIN or another national ID', 'BAD_ID_TYPE');
  const idNumber = parseId(idType, b.idNumber);
  const country = /^[A-Za-z]{2}$/.test(String(b.idCountry || '')) ? String(b.idCountry).toUpperCase() : 'NG';
  const legal = String(b.legalName || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (nameTokens(legal).length < 2) throw bad('Enter your full legal name as it is on your ID (first name and surname)', 'BAD_LEGAL_NAME');
  const code = String(b.bankCode || '').trim();
  const num = String(b.accountNumber || '').replace(/\s+/g, '');
  if (!/^[0-9]{2,20}$/.test(code)) throw bad('Choose your bank', 'BAD_BANK');
  if (!/^[0-9]{10}$/.test(num)) throw bad('Enter your 10-digit account number (NUBAN)', 'BAD_ACCOUNT_NUMBER');
  const { banks } = await bankList(env);
  const bank = banks.find((x) => x.code === code);
  if (!bank) throw bad('Choose your bank from the list', 'BAD_BANK');
  let accountName = String(b.accountName || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  let resolved = false;
  if (paystackConfigured(env)) {
    try { const r = await resolveAccount(env, { accountNumber: num, bankCode: code }); if (r.accountName) { accountName = r.accountName.slice(0, 120); resolved = true; } } catch (e) {
      throw new ApiError(400, 'ACCOUNT_NOT_FOUND', 'The bank couldn’t find that account number — check it and the bank');
    }
  }
  if (accountName.length < 2) throw bad('Enter the account name exactly as your bank shows it', 'BAD_ACCOUNT_NAME');
  if (!namesMatch(legal, accountName)) {
    const e = new ApiError(400, 'NAME_MISMATCH', resolved
      ? `The bank says this account belongs to “${accountName}”, which doesn’t match your legal name. Use an account in your own name.`
      : 'The account name doesn’t match your legal name. Use an account in your own name.');
    e.details = { accountName: resolved ? accountName : null };
    throw e;
  }
  const check = await idCheck(env, idType, idNumber, legal, accountName); // throws ID_NAME_MISMATCH / ID_NOT_FOUND
  const [idEnc, accEnc] = [await encryptField(env, idNumber), await encryptField(env, num)];
  await q(env, `INSERT INTO payout_kyc (user_id, id_type, id_country, id_number_enc, id_last4, legal_name, bank_code, bank_name, account_number_enc, account_last4,
        account_name, name_resolved, name_match, status, submitted_at, updated_at, id_verified, id_check_provider, id_check_status, id_check_note, id_checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, 'pending_review', now(), now(), $13, $14, $15, $16, $17)
    ON CONFLICT (user_id) DO UPDATE SET id_type = EXCLUDED.id_type, id_country = EXCLUDED.id_country, id_number_enc = EXCLUDED.id_number_enc,
      id_last4 = EXCLUDED.id_last4, legal_name = EXCLUDED.legal_name, bank_code = EXCLUDED.bank_code, bank_name = EXCLUDED.bank_name,
      account_number_enc = EXCLUDED.account_number_enc, account_last4 = EXCLUDED.account_last4, account_name = EXCLUDED.account_name,
      name_resolved = EXCLUDED.name_resolved, name_match = true, status = 'pending_review', review_note = NULL, reviewed_by = NULL, reviewed_at = NULL,
      submitted_at = now(), updated_at = now(), id_verified = EXCLUDED.id_verified, id_check_provider = EXCLUDED.id_check_provider,
      id_check_status = EXCLUDED.id_check_status, id_check_note = EXCLUDED.id_check_note, id_checked_at = EXCLUDED.id_checked_at`,
  [me.id, idType, country, idEnc, idNumber.slice(-4), legal, code, bank.name, accEnc, num.slice(-4), accountName, resolved,
    check.verified, check.provider, check.status, check.note, check.checkedAt]);
  // keep the Fund Me payout account on the same bank account (only when it differs: saving resets its review)
  const fa = await one(env, 'SELECT bank_code, account_number_enc FROM fundme_bank_accounts WHERE user_id = $1', [me.id]);
  let same = false;
  if (fa && fa.bank_code === code) { try { same = (await decryptField(env, fa.account_number_enc)) === num; } catch (e) { same = false; } }
  if (!same) await saveBankAccount(c, me, { bankCode: code, accountNumber: num, accountName });
  return kycShape(await getKyc(env, me.id));
}

// ─── automatic ID check (Dojah) ───────────────────────────────────────────────────────────────────────────────────
const initials = (n) => [n.firstName, n.middleName, n.lastName].filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(' ');
/**
 * → { verified, provider, status: 'matched' | 'not_checked', note, checkedAt }. Throws (and nothing is stored) when the
 * ID record's name doesn't match the legal name AND the bank account name, or the ID number has no record.
 * Never stores or returns the record itself: the note has the record name's initials only.
 */
export async function idCheck(env, idType, idNumber, legalName, accountName) {
  const skip = (note, provider = null) => ({ verified: false, provider, status: 'not_checked', note, checkedAt: null });
  if (!['bvn', 'nin'].includes(idType)) return skip('Other national ID: not checked automatically.');
  if (!dojahConfigured(env)) return skip('Automatic ID check is an upcoming feature: check the ID by hand.');
  const label = idType.toUpperCase();
  let rec;
  try { rec = await lookupId(env, idType, idNumber); } catch (e) {
    if (e && e.code === 'ID_NOT_FOUND') throw new ApiError(400, 'ID_NOT_FOUND', `We couldn’t find a ${label} record for that number — check it and try again.`);
    return skip(`Automatic ID check failed (${String((e && e.code) || 'error').slice(0, 40)}). Check the ID by hand.`, 'dojah');
  }
  const idName = fullName(rec);
  if (!namesMatch(idName, legalName) || !namesMatch(idName, accountName)) {
    throw new ApiError(400, 'ID_NAME_MISMATCH', `The name on your ${label} record doesn’t match your legal name and your bank account name. Enter your name exactly as it is on your ${label} and use an account in that name.`);
  }
  return { verified: true, provider: 'dojah', status: 'matched', note: `${label} record (${initials(rec)}) matches the legal name and the bank account name.`, checkedAt: new Date() };
}

/** Does the member's Fund Me payout account point at the KYC-approved bank account? */
export async function kycBankMatches(env, kyc, account) {
  if (!kyc || !account || kyc.bank_code !== account.bank_code || kyc.account_last4 !== account.account_last4) return false;
  try { return (await decryptField(env, kyc.account_number_enc)) === (await decryptField(env, account.account_number_enc)); } catch (e) { return false; }
}

// ─── staff ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** approve | reject (reason required). Approving also verifies the Fund Me payout account when it is the same account. */
export async function reviewKyc(env, admin, userId, action, reason) {
  const k = await getKyc(env, userId);
  if (!k) throw new ApiError(404, 'NOT_FOUND', 'No KYC submitted');
  if (!['approve', 'reject'].includes(action)) throw bad('action must be approve or reject');
  if (action === 'reject' && (!reason || String(reason).trim().length < 3)) throw bad('Add a short reason — the member sees it', 'REASON_REQUIRED');
  if (action === 'approve' && !k.name_match) throw new ApiError(409, 'NAME_MISMATCH', 'The legal name doesn’t match the bank account name');
  const status = action === 'approve' ? 'approved' : 'rejected';
  const r = await one(env, `UPDATE payout_kyc SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now()
      WHERE user_id = $1 AND updated_at = $5 RETURNING *`, [userId, status, reason || null, admin.id, k.updated_at]);
  if (!r) throw new ApiError(409, 'STATE_CHANGED', 'The member changed these details meanwhile — reload');
  let bankVerified = false;
  if (action === 'approve') {
    const acct = await one(env, 'SELECT * FROM fundme_bank_accounts WHERE user_id = $1', [userId]);
    if (acct && acct.status !== 'verified' && await kycBankMatches(env, r, acct)) {
      const u = await q(env, `UPDATE fundme_bank_accounts SET status = 'verified', review_note = 'Verified with payout KYC', reviewed_by = $2, reviewed_at = now()
          WHERE user_id = $1 AND updated_at = $3 RETURNING user_id`, [userId, admin.id, acct.updated_at]);
      bankVerified = u.length > 0;
    }
  }
  return { kyc: kycShape(r, { admin: true }), bankVerified };
}

/** Full ID number for staff (the route logs every reveal). */
export async function revealKycId(env, userId) {
  const k = await getKyc(env, userId);
  if (!k) throw new ApiError(404, 'NOT_FOUND', 'No KYC submitted');
  return { idType: k.id_type, idNumber: await decryptField(env, k.id_number_enc), accountNumber: await decryptField(env, k.account_number_enc), bankName: k.bank_name, accountName: k.account_name, legalName: k.legal_name };
}
