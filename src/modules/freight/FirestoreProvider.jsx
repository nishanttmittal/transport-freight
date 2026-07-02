/**
 * Firestore-backed Freight state — real-time, multi-device, offline-capable.
 * Same value shape as the local provider. No master seeding (transporters and
 * destinations are added in the app).
 */
import { useEffect, useState, useCallback } from 'react'
import { onSnapshot, setDoc, deleteDoc, getDocs, writeBatch, runTransaction, query, where } from 'firebase/firestore'
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
function useCloudCollection(collPath, docPath, normalize, authKey, scope = null) {
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
  return {
    list,
    insert: (rec) => { const id = rec.id || makeId('r'); const now = new Date().toISOString(); const row = { createdAt: now, updatedAt: now, ...rec, id }; setDoc(docPath(id), row); return row },
    update: (id, patch) => setDoc(docPath(id), { ...patch, updatedAt: new Date().toISOString() }, { merge: true }),
    remove: (id) => deleteDoc(docPath(id)),
    removeWhere: (pred) => { const hit = list.filter(pred); const b = writeBatch(db); hit.forEach(r => b.delete(docPath(r.id))); b.commit(); return hit.length },
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

export function FirestoreProvider({ children }) {
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [error, setError] = useState('')
  const [authKey, setAuthKey] = useState('anon')
  const [authEmail, setAuthEmail] = useState('')
  useEffect(() => watchAuth((u) => {
    setAuthKey(u ? `${u.uid}:${u.email || ''}` : 'none')
    setAuthEmail(u && !u.isAnonymous ? (u.email || '').toLowerCase() : '')
  }), [])

  // masters + users load whole-collection (any signed-in may read them)
  const transporters = useCloudCollection(paths.transporters, paths.transporter, normTransporter, authKey)
  const destinations = useCloudCollection(paths.destinations, paths.destination, normDestination, authKey)
  const users        = useCloudCollection(paths.users, paths.user, normUser, authKey)
  const logs         = useCloudCollection(paths.logs, paths.logDoc, (r) => r, authKey)

  // If the signed-in user is a gaadiwala, scope his trip/payment/settlement reads
  // to his own transporterId (matches the restrictive rules; whole-collection
  // reads would be denied for him). Owner/manager keep whole-collection.
  const me = users.list.find(u => (u.email || '').toLowerCase() === authEmail)
  const isBootstrapOwner = OWNER_EMAILS.map(x => x.toLowerCase()).includes(authEmail)
  const gTid = (me && me.role === 'gaadiwala' && me.active !== false && !isBootstrapOwner) ? (me.transporterId || '') : ''
  const scope = gTid ? { field: 'transporterId', value: gTid } : null

  const entries      = useCloudCollection(paths.entries, paths.entry, normEntry, authKey, scope)
  const advances     = useCloudCollection(paths.advances, paths.advance, normAdvance, authKey, scope)
  const settlements  = useCloudCollection(paths.settlements, paths.settlementDoc, normSettlement, authKey, scope)

  useEffect(() => {
    let done = false
    const timer = setTimeout(() => { if (!done) setTimedOut(true) }, 12000)
    // probe users (readable by any signed-in device, incl. anonymous) so
    // readiness resolves before Google sign-in.
    const unsub = onSnapshot(paths.users(),
      () => { done = true; clearTimeout(timer); setReady(true) },
      (e) => { done = true; clearTimeout(timer); setError(e.message); setReady(true) })
    ensureSignedIn().catch((e) => { done = true; clearTimeout(timer); setError(e.message); setTimedOut(true) })
    return () => { clearTimeout(timer); unsub() }
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
    entries: { ...entries, updateGuarded: (id, rev, patch) => updateGuarded(paths.entry, id, rev, patch) },
    advances, settlements, users, logs,
    lastUsed: lastUsedStore, log, allocateNumber,
    cloud: { connected: !error, error },
  }
  return <FreightCtx.Provider value={value}>{children}</FreightCtx.Provider>
}
