/**
 * Idempotent commit body shared by chakkar + advance uploads. The outbox delivers
 * at-least-once (an upload can be retried after a lost server response), and the
 * running-balance uses a non-idempotent `increment`. So we guard: read a stable
 * "guard" doc (the first entry row, or the advance itself) INSIDE the transaction;
 * if it already exists the item was already uploaded → write nothing. This mirrors
 * the existing reversal guard (rev_<paymentNo>) and keeps balances exact on replay.
 * Firestore requires all reads before writes — the guard get() is first.
 */
export async function commitOnceTx(tx, { guardRef, docs, balance, increment }) {
  const snap = await tx.get(guardRef)
  if (snap && snap.exists && snap.exists()) return { ok: true, already: true }
  const now = new Date().toISOString()
  for (const d of docs) tx.set(d.ref, { createdAt: now, updatedAt: now, ...d.data })
  if (balance && balance.ref && Number(balance.delta)) {
    const patch = { runningBalance: increment(Number(balance.delta) || 0), updatedAt: now }
    if (typeof balance.level === 'number') patch.alertedLevel = balance.level
    tx.set(balance.ref, patch, { merge: true })
  }
  return { ok: true }
}
