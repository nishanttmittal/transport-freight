/**
 * Firestore-backed Freight state — real-time, multi-device, offline-capable.
 * Same value shape as the local provider. No master seeding (transporters and
 * destinations are added in the app).
 */
import { useEffect, useState, useCallback } from 'react'
import { onSnapshot, setDoc, deleteDoc, getDocs, writeBatch, runTransaction, query, where, increment } from 'firebase/firestore'
import { db, paths, ensureSignedIn, watchAuth } from '../../core/db/firebase'
import { makeNormalizer } from '../../core/schema/field'
import { makeId } from '../../core/db/repository'
import { transporterSchema, destinationSchema, entrySchema, advanceSchema, settlementSchema, userSchema } from './schema'
import { OWNER_EMAILS } from './config'
import { nextFromCounters, COUNTER_START } from './logic/counters'
import { isStale } from './logic/status'
import { lastUsedStore } from './data'
import { FreightCtx } from './FreightContext'

// authKey re-subscribes the listener when the signed-in user changes (anon →
// Google). Tolerates permission-denied by leaving the collection empty.
// `scope` ({field,value}) narrows the listen to a where() query — used so a
// gaadiwala reads ONLY his own transporterId (required once rules restrict him).
function useCloudCollection(collPath, docPath, normalize, authKey, scope = null, onError = () => {}) {
  const [list, setList] = useState([])
  const scopeVal = scope ? scope.value : ''
  useEffect(() => {
    const src = scope ? query(collPath(), where(scope.field, '==', scope.value)) : collPath()
    const unsub = onSnapshot(
      src,
      (snap) => setList(snap.docs.map(d => normalize({ id: d.id, ...d.data() }))),
      () => setList([])
    )
    return unsub
  }, [authKey, scopeVal]) // eslint-disable-line react-hooks/exhaustive-deps
  // every write is wrapped so a permission-denied / offline failure surfaces a
  // banner instead of a silent "saved" (P1.6). insert() still returns the row
  // synchronously (id is client-made) AND returns the promise on `.saved` so a
  // caller can await it; fire-and-forget callers just get the surfaced error.
  const wrap = (p) => { p && p.catch && p.catch(onError); return p }
  return {
    list,
    insert: (rec) => { const id = rec.id || makeId('r'); const now = new Date().toISOString(); const row = { createdAt: now, updatedAt: now, ...rec, id }; row.saved = wrap(setDoc(docPath(id), row)); return row },
    update: (id, patch) => wrap(setDoc(docPath(id), { ...patch, updatedAt: new Date().toISOString() }, { merge: true })),
    remove: (id) => wrap(deleteDoc(docPath(id))),
    // Atomic delta on runningBalance so simultaneous saves can't clobber each
    // other (P1.2). alertedLevel is a cosmetic hint computed from the local view
    // — Admin "Recalculate" is the exact safety net if it ever drifts.
    incBalance: (id, delta, level) => wrap(setDoc(docPath(id), { runningBalance: increment(Number(delta) || 0), alertedLevel: level, updatedAt: new Date().toISOString() }, { merge: true })),
    removeWhere: (pred) => { const hit = list.filter(pred); const b = writeBatch(db); hit.forEach(r => b.delete(docPath(r.id))); wrap(b.commit()); return hit.length },
    replaceAll: async (rows) => {
      const ex = await getDocs(collPath()); const b1 = writeBatch(db); ex.forEach(d => b1.delete(d.ref)); await b1.commit()
      const b2 = writeBatch(db); (rows || []).forEach(r => { const id = r.id || makeId('r'); b2.set(docPath(id), { ...r, id }) }); await b2.commit()
    },
    reset: async () => { const ex = await getDocs(collPath()); const b = writeBatch(db); ex.forEach(d => b.delete(d.ref)); await b.commit() },
  }
}

const normTransporter = makeNormalizer(transporterSchema)
const normDestination = makeNormalizer(destinationSchema)
const normEntry       = makeNormalizer(entrySchema)
const normAdvance     = makeNormalizer(advanceSchema)
const normSettlement  = makeNormalizer(settlementSchema)
const normUser        = makeNormalizer(userSchema)

/** Allocate the next reference number atomically (server-side transaction). */
async function allocateNumber(kind) {
  return await runTransaction(db, async (tx) => {
    const ref = paths.counters()
    const snap = await tx.get(ref)
    const cur = snap.exists() ? snap.data() : {}
    const next = nextFromCounters(cur, kind, COUNTER_START[kind])
    tx.set(ref, { [kind]: next }, { merge: true })
    return next
  })
}

/** Update a doc only if its stored `revision` still matches (optimistic lock). */
async function updateGuarded(docPathFn, id, expectedRevision, patch) {
  return await runTransaction(db, async (tx) => {
    const ref = docPathFn(id)
    const snap = await tx.get(ref)
    const actual = snap.exists() ? (Number(snap.data().revision) || 0) : 0
    if (isStale(expectedRevision, actual)) return { ok: false, reason: 'stale' }
    tx.set(ref, { ...patch, revision: actual + 1, updatedAt: new Date().toISOString() }, { merge: true })
    return { ok: true }
  })
}

/**
 * Commit a WHOLE chakkar (multi-drop) in ONE Firestore transaction — all-or-
 * nothing (P1.3). A chakkar is several entry rows sharing a batchId; passing,
 * returning, cancelling or editing it must never leave some rows changed and
 * others stale. `updates` are revision-guarded (optimistic lock); if ANY row
 * moved on we abort with {ok:false,reason:'stale'} and write nothing. `inserts`
 * (new drops on an edit) and `softDeletes` (removed drops) ride the same txn.
 */
async function commitBatchGuarded(docPathFn, { updates = [], inserts = [], softDeletes = [] }) {
  return await runTransaction(db, async (tx) => {
    const now = new Date().toISOString()
    // Firestore requires all reads before any write.
    const read = []
    for (const u of updates) read.push([u, await tx.get(docPathFn(u.id))])
    for (const [u, snap] of read) {
      const actual = snap.exists() ? (Number(snap.data().revision) || 0) : 0
      if (isStale(u.expectedRevision, actual)) return { ok: false, reason: 'stale' }
    }
    for (const [u, snap] of read) {
      const actual = snap.exists() ? (Number(snap.data().revision) || 0) : 0
      tx.set(docPathFn(u.id), { ...u.patch, revision: actual + 1, updatedAt: now }, { merge: true })
    }
    for (const ins of inserts) tx.set(docPathFn(ins.id), { createdAt: now, updatedAt: now, ...ins })
    for (const id of softDeletes) tx.set(docPathFn(id), { deleted: true, updatedAt: now }, { merge: true })
    return { ok: true }
  })
}

/**
 * Settle a hisab as ONE atomic write (all-or-nothing). Settling touches three
 * collections — the settlement payment (advance), the locked settlement snapshot,
 * and the transporter's carried-forward running balance. Done as separate writes,
 * a mid-way network drop leaves a HALF-SETTLED state (money recorded but period
 * not locked, or locked but Dashboard's cached balance stale). A writeBatch makes
 * all three commit together or not at all. The payment/settlement NUMBERS are
 * allocated by their own atomic counter txns BEFORE this call — a burned number on
 * failure is just a harmless gap in the sequence.
 */
async function settleBatch({ payment = null, settlement, transporterId, transporterPatch }) {
  const now = new Date().toISOString()
  const b = writeBatch(db)
  let paymentId = null
  if (payment) {
    paymentId = payment.id || makeId('r')
    b.set(paths.advance(paymentId), { createdAt: now, updatedAt: now, ...payment, id: paymentId })
  }
  const settlementId = settlement.id || makeId('r')
  b.set(paths.settlementDoc(settlementId), { createdAt: now, updatedAt: now, ...settlement, id: settlementId })
  b.set(paths.transporter(transporterId), { ...transporterPatch, updatedAt: now }, { merge: true })
  await b.commit()
  return { paymentId, settlementId }
}

export function FirestoreProvider({ children }) {
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [error, setError] = useState('')
  const [authKey, setAuthKey] = useState('anon')
  const [authEmail, setAuthEmail] = useState('')
  const [writeError, setWriteError] = useState('')
  const reportWriteError = useCallback((e) => {
    setWriteError((e && e.message) || 'Save failed — check your connection and try again.')
  }, [])
  useEffect(() => watchAuth((u) => {
    setAuthKey(u ? `${u.uid}:${u.email || ''}` : 'none')
    setAuthEmail(u && !u.isAnonymous ? (u.email || '').toLowerCase() : '')
  }), [])

  // masters + users load whole-collection (readable by any Google-signed-in
  // user; anonymous baseline is denied — see rules nonAnon()).
  const transporters = useCloudCollection(paths.transporters, paths.transporter, normTransporter, authKey, null, reportWriteError)
  const destinations = useCloudCollection(paths.destinations, paths.destination, normDestination, authKey, null, reportWriteError)
  const users        = useCloudCollection(paths.users, paths.user, normUser, authKey, null, reportWriteError)
  const logs         = useCloudCollection(paths.logs, paths.logDoc, (r) => r, authKey, null, reportWriteError)

  // If the signed-in user is a gaadiwala, scope his trip/payment/settlement reads
  // to his own transporterId (matches the restrictive rules; whole-collection
  // reads would be denied for him). Owner/manager keep whole-collection.
  const me = users.list.find(u => (u.email || '').toLowerCase() === authEmail)
  const isBootstrapOwner = OWNER_EMAILS.map(x => x.toLowerCase()).includes(authEmail)
  const gTid = (me && me.role === 'gaadiwala' && me.active !== false && !isBootstrapOwner) ? (me.transporterId || '') : ''
  const scope = gTid ? { field: 'transporterId', value: gTid } : null

  const entries      = useCloudCollection(paths.entries, paths.entry, normEntry, authKey, scope, reportWriteError)
  const advances     = useCloudCollection(paths.advances, paths.advance, normAdvance, authKey, scope, reportWriteError)
  const settlements  = useCloudCollection(paths.settlements, paths.settlementDoc, normSettlement, authKey, scope, reportWriteError)

  useEffect(() => {
    let done = false
    const timer = setTimeout(() => { if (!done) setTimedOut(true) }, 12000)
    // Readiness = anonymous baseline sign-in completing. We no longer probe a
    // Firestore read here: masters/users are now nonAnon-only (P1.5), so an anon
    // read would be denied. Collection listeners each degrade gracefully to []
    // on permission-denied, and the AuthGate handles the Google sign-in step.
    ensureSignedIn()
      .then(() => { done = true; clearTimeout(timer); setReady(true) })
      .catch((e) => { done = true; clearTimeout(timer); setError(e.message); setTimedOut(true) })
    return () => clearTimeout(timer)
  }, [])

  const log = useCallback((action, detail, by = 'user', ref = '') => {
    const id = makeId('log')
    setDoc(paths.logDoc(id), { id, ts: new Date().toISOString(), action, detail, by, ref })
  }, [])

  if (!ready && timedOut) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white gap-4 p-6 text-center">
        <div className="text-4xl">📡</div>
        <div className="text-base font-bold">Can't reach the cloud</div>
        <div className="text-sm text-slate-300 max-w-xs">Check internet and try again.</div>
        <button onClick={() => window.location.reload()} className="mt-2 bg-white text-slate-900 rounded-xl px-6 py-3 font-bold text-sm">Retry</button>
      </div>
    )
  }
  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white gap-3">
        <div className="text-2xl">☁️</div><div className="text-sm text-slate-300">Connecting to cloud…</div>
      </div>
    )
  }

  const value = {
    transporters, destinations,
    entries: {
      ...entries,
      updateGuarded: (id, rev, patch) => updateGuarded(paths.entry, id, rev, patch),
      commitBatch: (spec) => commitBatchGuarded(paths.entry, spec),
    },
    advances, settlements, users, logs,
    lastUsed: lastUsedStore, log, allocateNumber, settleBatch,
    cloud: { connected: !error, error },
  }
  return (
    <FreightCtx.Provider value={value}>
      {writeError && (
        <div className="fixed top-0 inset-x-0 z-50 bg-red-600 text-white text-sm px-4 py-3 flex items-center gap-3 shadow-lg"
          style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
          <span className="flex-1">⚠️ A save didn’t go through. Check your internet and try again.</span>
          <button onClick={() => setWriteError('')} className="font-bold bg-white/20 rounded-lg px-3 py-1">Dismiss</button>
        </div>
      )}
      {children}
    </FreightCtx.Provider>
  )
}
