/**
 * Chakkar approval workflow — pure state logic. No React/Firebase.
 * Legacy rows (no `status`) are treated as 'passed' so the existing hisab is
 * unchanged when this ships.
 */
import { entryTotal } from './calc.js'

export const STATUS = {
  pending: 'pending',
  needs_correction: 'needs_correction',
  passed: 'passed',
  voided: 'voided',
  cancelled: 'cancelled',
}

/** A row contributes to the hisab/balance only when it's passed and not deleted. */
export function countsInHisab(e) {
  if (!e || e.deleted) return false
  const s = e.status || STATUS.passed // legacy default
  return s === STATUS.passed
}

/** Optimistic-concurrency check: true if the stored revision moved on. */
export function isStale(expected, actual) {
  return (Number(expected) || 0) !== (Number(actual) || 0)
}

/**
 * Find a likely duplicate of `cand` among `entries`: same gaadiwala + gaadi no +
 * date + total (and same first destination when the candidate has one). Ignores
 * voided/cancelled/deleted rows. Returns the matching entry or null (warn only).
 */
export function findDuplicate(entries, cand) {
  const tot = entryTotal(cand)
  return (entries || []).find(e =>
    !e.deleted && e.status !== STATUS.voided && e.status !== STATUS.cancelled &&
    e.transporterId === cand.transporterId &&
    (e.gaadiNumber || '') === (cand.gaadiNumber || '') &&
    e.date === cand.date &&
    entryTotal(e) === tot &&
    (!cand.destinationId || e.destinationId === cand.destinationId)
  ) || null
}

/** A reversing payment (negative) that undoes `p` without editing the original. */
export function makeReversal(p, by) {
  return {
    transporterId: p.transporterId,
    date: new Date().toISOString().slice(0, 10),
    amount: -(Number(p.amount) || 0),
    paidBy: p.paidBy || '',
    note: `Reversal of PAY-${String(p.paymentNo || 0).padStart(4, '0')}`,
    reversesPaymentNo: Number(p.paymentNo) || 0,
    reversal: true,
    createdByUser: by || '',
    deleted: false,
  }
}

const nowIso = () => new Date().toISOString()
const need = (v, msg) => { if (!v || !String(v).trim()) throw new Error(msg) }

/** Legal transitions keyed by current status. */
const ALLOWED = {
  pending:          ['pass', 'void', 'return'],
  needs_correction: ['resubmit', 'void'],
  passed:           ['cancel'],
  voided:           [],
  cancelled:        [],
}

/**
 * Apply an approval action to a chakkar, returning the updated record.
 * @param entry current record  @param action pass|void|return|resubmit|cancel
 * @param ctx { by, role, reason, challanNo }
 * Throws on an illegal transition or a missing mandatory reason.
 */
export function applyTransition(entry, action, ctx = {}) {
  const cur = entry.status || STATUS.passed
  if (!(ALLOWED[cur] || []).includes(action)) {
    throw new Error(`illegal transition: cannot ${action} a ${cur} chakkar`)
  }
  const base = { ...entry, updatedAt: nowIso() }
  switch (action) {
    case 'pass':
      return { ...base, status: STATUS.passed, approvedBy: ctx.by || '', approvedAt: nowIso(), challanNo: Number(ctx.challanNo) || entry.challanNo || 0 }
    case 'void':
      need(ctx.reason, 'void reason is required')
      return { ...base, status: STATUS.voided, voidReason: ctx.reason }
    case 'return':
      need(ctx.reason, 'correction reason is required')
      return { ...base, status: STATUS.needs_correction, correctionReason: ctx.reason }
    case 'resubmit':
      return { ...base, status: STATUS.pending, correctionReason: '' }
    case 'cancel':
      need(ctx.reason, 'cancel reason is required')
      return { ...base, status: STATUS.cancelled, cancelReason: ctx.reason }
    default:
      throw new Error(`unknown action ${action}`)
  }
}
