/**
 * Running-balance helpers — keep each transporter's balance up to date WITHOUT
 * re-reading the whole entries collection on every screen (quota-safe). The
 * Dashboard reads only the transporters list for headline balances; full entries
 * are read only when one transporter is opened. Admin "Recalculate" can rebuild
 * a balance from scratch as a safety net.
 */
import { transporterTotals, unsettledFrom, openingBalance, thresholdLevel, crossingAlert } from './calc.js'
import { THRESHOLD_LEVELS } from '../config.js'

const num = (v) => Number(v) || 0

/**
 * Apply a delta to a transporter's running balance and refresh its alert level.
 * @param {object} transporters  useCollection handle ({ list, update })
 * @param {string} transporterId
 * @param {number} delta          +rupees for a new entry, −rupees for an advance
 * @returns {number|null} a newly-crossed threshold level (for a one-time toast), else null
 */
export function applyBalance(transporters, transporterId, delta) {
  const t = (transporters.list || []).find(x => x.id === transporterId)
  if (!t) return null
  const prev = num(t.runningBalance)
  const next = prev + num(delta)
  const crossed = crossingAlert(prev, next, THRESHOLD_LEVELS)
  const level = thresholdLevel(next, THRESHOLD_LEVELS)
  // Write an ATOMIC delta (P1.2): the server computes prev+delta, so two staff
  // saving at the same instant can never overwrite each other's balance.
  // `level`/`crossed` are best-effort hints from the local view (cosmetic);
  // Admin "Recalculate" rebuilds the exact balance if the alert hint ever drifts.
  if (typeof transporters.incBalance === 'function') transporters.incBalance(transporterId, num(delta), level)
  else transporters.update(transporterId, { runningBalance: next, alertedLevel: level })
  return crossed
}

/**
 * Compute the alert `level` and any newly-`crossed` threshold for a balance
 * delta, WITHOUT writing anything. Used so the running-balance update can ride
 * the SAME atomic transaction as the financial record (P1-2), while the caller
 * still gets the level to store and a crossed-level for a one-time toast.
 */
export function balanceHint(transporters, transporterId, delta) {
  const t = (transporters.list || []).find(x => x.id === transporterId)
  const prev = num(t && t.runningBalance)
  const next = prev + num(delta)
  return { level: thresholdLevel(next, THRESHOLD_LEVELS), crossed: crossingAlert(prev, next, THRESHOLD_LEVELS) }
}

/** Recompute a transporter's UNSETTLED balance from raw data (safety net).
 *  Includes any brought-forward balance from the last settlement so a
 *  Recalculate never wipes a carried-forward remainder. */
export function recomputeBalance({ entries, advances, settlements }, transporterId) {
  const from = unsettledFrom(settlements, transporterId)
  const opening = openingBalance(settlements, transporterId)
  const { balance } = transporterTotals(entries, advances, transporterId, { from, opening })
  return balance
}

/** Escalating colour styling for a crossed threshold level. */
export function levelStyle(level) {
  switch (level) {
    case 20000: return { bg: 'bg-red-700',    text: 'text-white',      ring: 'ring-red-700',    label: '₹20,000+' }
    case 15000: return { bg: 'bg-red-500',    text: 'text-white',      ring: 'ring-red-500',    label: '₹15,000+' }
    case 10000: return { bg: 'bg-orange-500', text: 'text-white',      ring: 'ring-orange-500', label: '₹10,000+' }
    case 5000:  return { bg: 'bg-amber-400',  text: 'text-amber-950',  ring: 'ring-amber-400',  label: '₹5,000+' }
    default:    return { bg: 'bg-slate-100',  text: 'text-slate-600',  ring: 'ring-slate-200',  label: '' }
  }
}
