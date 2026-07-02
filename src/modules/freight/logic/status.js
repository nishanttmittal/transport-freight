/**
 * Chakkar approval workflow — pure state logic. No React/Firebase.
 * Legacy rows (no `status`) are treated as 'passed' so the existing hisab is
 * unchanged when this ships.
 */
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
