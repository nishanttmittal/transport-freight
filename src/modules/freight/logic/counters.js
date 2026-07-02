/**
 * Number allocation for challan / payment / settlement references.
 * The pure `nextFromCounters` is unit-tested; the actual allocation runs inside
 * a Firestore transaction (server-atomic, collision-proof) in FirestoreProvider.
 */

/** Next reference number given the current counters doc. Kinds: challan|payment|settlement. */
export function nextFromCounters(counters, kind, start = 1) {
  const last = Number((counters || {})[kind]) || 0
  return Math.max(last + 1, start)
}

/** Where each series begins (set once before go-live to continue a paper book). */
export const COUNTER_START = { challan: 1, payment: 1, settlement: 1 }
