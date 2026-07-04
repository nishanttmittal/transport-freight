/**
 * Freight money math — pure & derived. No React/Firebase. Money in whole ₹.
 * Hisab for a transporter = Σ(entry totals) − Σ(advances), excluding reversed
 * advances and soft-deleted rows. Settled periods lock entries dated on/before
 * the settlement cutoff.
 */
import { countsInHisab } from './status.js'

const num = (v) => Number(v) || 0

/** All charges on one drop. */
export function entryTotal(e) {
  return num(e.freight) + num(e.lrCharge) + num(e.unloading) + num(e.misc) + num(e.extraPoint)
}

/** Next global challan/reference number = highest used so far + 1 (or `start`). */
export function nextChallanNo(entries, start = 1) {
  let max = 0
  for (const e of (entries || [])) { const c = num(e.challanNo); if (c > max) max = c }
  return Math.max(max + 1, start)
}

/** The latest locked settlement for a transporter (null if none). */
export function latestSettlement(settlements, transporterId) {
  const locked = (settlements || [])
    .filter(s => s.transporterId === transporterId && s.locked !== false && s.periodTo)
    .sort((a, b) => (a.periodTo || '').localeCompare(b.periodTo || ''))
  return locked.length ? locked[locked.length - 1] : null
}

/** Cutoff date of the latest locked settlement for a transporter ('' if none). */
export function unsettledFrom(settlements, transporterId) {
  const s = latestSettlement(settlements, transporterId)
  return s ? s.periodTo : ''
}

/**
 * Opening balance carried into the CURRENT period = the closing balance left
 * unpaid at the last settlement. 0 if never settled. This is what makes an
 * unpaid remainder roll forward instead of vanishing when a hisab is settled.
 */
export function openingBalance(settlements, transporterId) {
  const s = latestSettlement(settlements, transporterId)
  return s ? num(s.closingBalance) : 0
}

/**
 * Totals for a transporter. By default counts only UNSETTLED activity (after the
 * latest locked cutoff). Pass { from } to override the lower bound, { upToDate }
 * to cap the upper bound.
 */
export function transporterTotals(entries, advances, transporterId, opts = {}) {
  const from = opts.from
  const to = opts.upToDate
  const opening = num(opts.opening) // carried-forward unpaid balance (0 if none)
  const inRange = (d) => (!from || (d || '') > from) && (!to || (d || '') <= to)
  let freight = 0, adv = 0
  for (const e of (entries || [])) {
    if (e.transporterId !== transporterId || !countsInHisab(e)) continue
    if (!inRange(e.date)) continue
    freight += entryTotal(e)
  }
  for (const a of (advances || [])) {
    if (a.transporterId !== transporterId || a.reversed || a.deleted) continue
    if (!inRange(a.date)) continue
    adv += num(a.amount)
  }
  return { freight, advances: adv, opening, balance: opening + freight - adv }
}

/**
 * Validate one drop's money fields before it can be saved/passed. Returns an
 * error string, or '' when OK. Blocks negative charges/bags (a negative "freight"
 * would silently REDUCE what we owe the gaadiwala) and a zero-total drop (a
 * meaningless record). Money integrity: a passed chakkar must add a positive
 * amount to the hisab.
 */
export function dropError(d) {
  for (const f of ['freight', 'lrCharge', 'unloading', 'misc', 'extraPoint', 'bags']) {
    if (num(d && d[f]) < 0) return 'Amounts cannot be negative'
  }
  if (entryTotal(d) <= 0) return 'Enter an amount — total must be more than ₹0'
  return ''
}

/**
 * Reason a gaadiwala CANNOT be removed (soft-deleted), or '' if safe to remove.
 * Removing one who still has an open balance or trip history would hide a live
 * payable from the dashboard. Such a gaadiwala should be set inactive (hidden
 * from new entry) — never deleted.
 */
export function transporterDeleteBlock({ runningBalance = 0, hasEntries = false } = {}) {
  if (num(runningBalance) !== 0) return 'has an open balance'
  if (hasEntries) return 'has trip history'
  return ''
}

/** Highest threshold level the balance has crossed (0 if below the first). */
export function thresholdLevel(balance, levels) {
  let hit = 0
  for (const lv of levels) if (num(balance) >= lv) hit = lv
  return hit
}

/** A newly-crossed level when balance rises from prev to next, else null. */
export function crossingAlert(prev, next, levels) {
  const before = thresholdLevel(prev, levels)
  const after = thresholdLevel(next, levels)
  return after > before ? after : null
}

/** The locked settlement covering this date for a transporter, or null. */
export function lockedOn(settlements, transporterId, date) {
  if (!settlements || !date) return null
  return (settlements).find(s =>
    s.transporterId === transporterId && s.locked !== false && (s.periodTo || '') >= date) || null
}

/**
 * Dated ledger lines (entries + advances) for a transporter within a window,
 * newest-last, with a running balance — used by the Hisab/Ledger screen.
 */
export function ledgerLines(entries, advances, transporterId, opts = {}) {
  const from = opts.from
  const to = opts.upToDate
  const opening = num(opts.opening) // brought-forward balance from the last settlement
  const inRange = (d) => (!from || (d || '') > from) && (!to || (d || '') <= to)
  const rows = []
  for (const e of (entries || [])) {
    if (e.transporterId !== transporterId || !countsInHisab(e) || !inRange(e.date)) continue
    rows.push({ id: e.id, date: e.date, kind: 'freight', challanNo: num(e.challanNo), destinationId: e.destinationId, gaadiNumber: e.gaadiNumber, bags: num(e.bags), amount: entryTotal(e), debit: entryTotal(e), credit: 0, _s: e.createdAt || '' })
  }
  for (const a of (advances || [])) {
    if (a.transporterId !== transporterId || a.reversed || a.deleted || !inRange(a.date)) continue
    rows.push({ id: a.id, date: a.date, kind: 'advance', paidBy: a.paidBy, note: a.note, amount: num(a.amount), debit: 0, credit: num(a.amount), _s: a.createdAt || '' })
  }
  rows.sort((x, y) => (x.date || '').localeCompare(y.date || '') || (x._s || '').localeCompare(y._s || ''))
  // A non-zero carried balance shows as the oldest line and seeds the running total.
  const out = opening ? [{ id: '__opening__', date: from || '', kind: 'opening', amount: opening, debit: opening, credit: 0, _s: '' }] : []
  let bal = 0
  for (const r of [...out, ...rows]) { bal += r.debit - r.credit; r.balance = bal }
  return [...out, ...rows]
}
