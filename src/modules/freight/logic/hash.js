/**
 * Reproducible settlement fingerprint. A PDF hash is NOT reliable (jsPDF embeds
 * a creation timestamp, so the same statement hashes differently later). Instead
 * we hash a CANONICAL JSON of the settlement's financial facts — regenerating it
 * from the same data always yields the same hash, so "this is what was paid" is
 * provable years later.
 */
export function canonicalSettlement(s) {
  const o = {
    settlementNo: Number(s.settlementNo) || 0,
    transporterId: s.transporterId || '',
    transporterName: s.transporterName || '',
    periodFrom: s.periodFrom || '',
    periodTo: s.periodTo || '',
    totalFreight: Number(s.totalFreight) || 0,
    totalPayments: Number(s.totalPayments) || 0,
    closingBalance: Number(s.closingBalance) || 0,
    lineIds: (s.lineIds || []).slice().sort(),
  }
  return JSON.stringify(o)
}

export async function sha256hex(str) {
  try {
    const buf = new TextEncoder().encode(str)
    const d = await crypto.subtle.digest('SHA-256', buf)
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
  } catch { return '' }
}
