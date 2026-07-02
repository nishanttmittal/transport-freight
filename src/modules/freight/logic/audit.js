/**
 * Append-only audit lines for the approval workflow. Pure — the caller passes
 * `device` (navigator.userAgent) so this stays testable without a browser.
 */
export function auditLine(action, { by = '', role = '', reason = '', before = null, after = null, device = '' } = {}) {
  return { ts: new Date().toISOString(), action, by, role, reason, device, before, after }
}
