/**
 * Formatting & date helpers — pure, dependency-free, shared by all modules.
 */

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** ISO yyyy-mm-dd for today.
 *  WARNING - KNOWN BUG (verified 2026-07-19, not yet fixed):
 *  toISOString() returns a UTC date, NOT local. Between 00:00 and 05:29 IST
 *  this gives YESTERDAY's date, so early-morning entries file under the wrong
 *  day. Correct fix = format the date in the Asia/Kolkata timezone.
 *  Deliberately NOT changed yet: it alters which day an entry is dated under,
 *  which touches money/reporting. Needs owner sign-off. Same bug in daysAgoStr. */
export const todayStr = () => new Date().toISOString().slice(0, 10)

/** ISO yyyy-mm-dd for N days before today (local). */
export const daysAgoStr = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/** ISO yyyy-mm-dd from day/month/year numbers. */
export const toISODate = (d, m, y) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** dd/mm/yyyy for display. */
export const fmtDate = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** Indian-format rupee/number, rounded to whole. */
export const fmtNum = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN')

/**
 * Canonicalise a name (product / contractor / party) so the SAME entity matches
 * as one string here AND in the Plating app. MUST stay identical to the Plating
 * app's normalizeProductName: folds curly inch/foot marks (17” → 17") and curly
 * apostrophes to straight, and collapses whitespace. Case is preserved. Without
 * this the welder could emit "X Frame 17”" while plating uses "X Frame 17"",
 * splitting one product into two and breaking cross-app balances.
 */
export const canonicalName = (s) =>
  String(s ?? '')
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

/** Decimal-friendly number (for weights like 0.5 kg) — up to 3 dp, no trailing zeros. */
export const fmtDec = (n) =>
  (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })
