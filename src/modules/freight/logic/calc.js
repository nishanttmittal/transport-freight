/**
 * Freight money math — pure & derived. No React/Firebase. Money in whole ₹.
 * Hisab for a transporter = Σ(entry totals) − Σ(advances), excluding reversed
 * advances and soft-deleted rows. Settled periods lock entries dated on/before
 * the settlement cutoff.
 */
const num = (v) => Number(v) || 0

/** All charges on one drop. */
export function entryTotal(e) {
  return num(e.freight) + num(e.lrCharge) + num(e.unloading) + num(e.misc) + num(e.extraPoint)
}

/** Cutoff date of the latest locked settlement for a transporter ('' if none). */
export function unsettledFrom(settlements, transporterId) {
  const locked = (settlements || [])
    .filter(s => s.transporterId === transporterId && s.locked !== false && s.periodTo)
    .map(s => s.periodTo)
    .sort()
  return locked.length ? locked[locked.length - 1] : ''
}

/**
 * Totals for a transporter. By default counts only UNSETTLED activity (after the
 * latest locked cutoff). Pass { from } to override the lower bound, { upToDate }
 * to cap the upper bound.
 */
export function transporterTotals(entries, advances, transporterId, opts = {}) {
  const from = opts.from
  const to = opts.upToDate
  const inRange = (d) => (!from || (d || '') > from) && (!to || (d || '') <= to)
  let freight = 0, adv = 0
  for (const e of (entries || [])) {
    if (e.transporterId !== transporterId || e.deleted) continue
    if (!inRange(e.date)) continue
    freight += entryTotal(e)
  }
  for (const a of (advances || [])) {
    if (a.transporterId !== transporterId || a.reversed || a.deleted) continue
    if (!inRange(a.date)) continue
    adv += num(a.amount)
  }
  return { freight, advances: adv, balance: freight - adv }
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
  const inRange = (d) => (!from || (d || '') > from) && (!to || (d || '') <= to)
  const rows = []
  for (const e of (entries || [])) {
    if (e.transporterId !== transporterId || e.deleted || !inRange(e.date)) continue
    rows.push({ id: e.id, date: e.date, kind: 'freight', destinationId: e.destinationId, gaadiNumber: e.gaadiNumber, bags: num(e.bags), amount: entryTotal(e), debit: entryTotal(e), credit: 0, _s: e.createdAt || '' })
  }
  for (const a of (advances || [])) {
    if (a.transporterId !== transporterId || a.reversed || a.deleted || !inRange(a.date)) continue
    rows.push({ id: a.id, date: a.date, kind: 'advance', paidBy: a.paidBy, note: a.note, amount: num(a.amount), debit: 0, credit: num(a.amount), _s: a.createdAt || '' })
  }
  rows.sort((x, y) => (x.date || '').localeCompare(y.date || '') || (x._s || '').localeCompare(y._s || ''))
  let bal = 0
  for (const r of rows) { bal += r.debit - r.credit; r.balance = bal }
  return rows
}
