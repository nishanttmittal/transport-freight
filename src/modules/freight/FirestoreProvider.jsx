/**
 * Firestore-backed Freight state — real-time, multi-device, offline-capable.
 * Same value shape as the local provider. No master seeding (transporters and
 * destinations are added in the app).
 */
import { useEffect, useState, useCallback } from 'react'
import { onSnapshot, setDoc, deleteDoc, getDocs, writeBatch } from 'firebase/firestore'
import { db, paths, ensureSignedIn, watchAuth } from '../../core/db/firebase'
import { makeNormalizer } from '../../core/schema/field'
import { makeId } from '../../core/db/repository'
import { transporterSchema, destinationSchema, entrySchema, advanceSchema, settlementSchema, userSchema } from './schema'
import { lastUsedStore } from './data'
import { FreightCtx } from './FreightContext'

// authKey re-subscribes the listener when the signed-in user changes (anon →
// Google). Tolerates permission-denied by leaving the collection empty.
function useCloudCollection(collPath, docPath, normalize, authKey) {
  const [list, setList] = useState([])
  useEffect(() => {
    const unsub = onSnapshot(
      collPath(),
      (snap) => setList(snap.docs.map(d => normalize({ id: d.id, ...d.data() }))),
      () => setList([])
    )
    return unsub
  }, [authKey]) // eslint-disable-line react-hooks/exhaustive-deps
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

export function FirestoreProvider({ children }) {
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [error, setError] = useState('')
  const [authKey, setAuthKey] = useState('anon')
  useEffect(() => watchAuth((u) => setAuthKey(u ? `${u.uid}:${u.email || ''}` : 'none')), [])

  const transporters = useCloudCollection(paths.transporters, paths.transporter, normTransporter, authKey)
  const destinations = useCloudCollection(paths.destinations, paths.destination, normDestination, authKey)
  const entries      = useCloudCollection(paths.entries, paths.entry, normEntry, authKey)
  const advances     = useCloudCollection(paths.advances, paths.advance, normAdvance, authKey)
  const settlements  = useCloudCollection(paths.settlements, paths.settlementDoc, normSettlement, authKey)
  const users        = useCloudCollection(paths.users, paths.user, normUser, authKey)
  const logs         = useCloudCollection(paths.logs, paths.logDoc, (r) => r, authKey)

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
    transporters, destinations, entries, advances, settlements, users, logs,
    lastUsed: lastUsedStore, log,
    cloud: { connected: !error, error },
  }
  return <FreightCtx.Provider value={value}>{children}</FreightCtx.Provider>
}
