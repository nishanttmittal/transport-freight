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
import { OWNER_EMAILS, fmtChallan, fmtPayment } from './config'
import { nextFromCounters, COUNTER_START } from './logic/counters'
import { isStale } from './logic/status'
import { commitOnceTx } from './logic/idempotent'
import { outboxList, outboxEnqueue, outboxUpdate, outboxRemove } from './logic/outbox'
import { lastUsedStore } from './data'
import { FreightCtx } from './FreightContext'
import PendingUploadBanner from './PendingUploadBanner'

// ids currently being uploaded — stops the foreground save and the background
// sync from processing the same item at once (which would burn a reference number).
const inFlight = new Set()

// authKey re-subscribes the listener when the signed-in user changes (anon →
// Google). Tolerates permission-denied by leaving the collection empty.
// `scope` ({field,value}) narrows the listen to a where() query — used so a
// gaadiwala reads ONLY his own transporterId (required once rules restrict him).
function useCloudCollection(collPath, docPath, normalize, authKey, scope = null, onError = () => {}, enabled = true) {
  const [list, setList] = useState([])
  const scopeVal = scope ? scope.value : ''
  useEffect(() => {
    // `enabled=false` = don't even attempt the read (used to gate the whole
    // `users` collection to managers, so a gaadiwala never hits a denied read).
    if (!enabled) { setList([]); return } // eslint-disable-line react-hooks/set-state-in-effect
    const src = scope ? query(collPath(), where(scope.field, '==', scope.value)) : collPath()
    const unsub = onSnapshot(
      src,
      (snap) => setList(snap.docs.map(d => normalize({ id: d.id, ...d.data() }))),
      () => setList([])
    )
    return unsub
  }, [authKey, scopeVal, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
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

/**
 * Subscribe to a SINGLE document (or nothing when docPathFn is null). Used to
 * read the signed-in user's OWN users/{email} doc for role resolution, so we
 * don't need to read the whole users collection (P1-1 — access-list privacy).
 */
function useCloudDoc(docPathFn, normalize, authKey) {
  const [data, setData] = useState(null)
  useEffect(() => {
    if (!docPathFn) { setData(null); return } // eslint-disable-line react-hooks/set-state-in-effect
    const unsub = onSnapshot(
      docPathFn(),
      (snap) => setData(snap.exists() ? normalize({ id: snap.id, ...snap.data() }) : null),
      () => setData(null)
    )
    return unsub
  }, [authKey]) // eslint-disable-line react-hooks/exhaustive-deps
  return data
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
async function commitBatchGuarded(docPathFn, { updates = [], inserts = [], softDeletes = [], balance = null }) {
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
    // The running-balance delta rides the SAME transaction (P1-2): a passed/
    // edited/cancelled chakkar and its balance change commit together or not at
    // all — never a financial record without its balance, or vice-versa.
    if (balance && balance.transporterId && Number(balance.delta)) {
      const patch = { runningBalance: increment(Number(balance.delta) || 0), updatedAt: now }
      if (typeof balance.level === 'number') patch.alertedLevel = balance.level
      tx.set(paths.transporter(balance.transporterId), patch, { merge: true })
    }
    return { ok: true }
  })
}

/**
 * Write an advance (or a reversal) AND the transporter's running-balance delta as
 * ONE writeBatch (P1-2/P1-5) — the payment record and the balance change commit
 * together or not at all. A deterministic reversal id (rev_<paymentNo>) makes a
 * repeat/duplicate reversal idempotent (writes the same doc, never doubles).
 */
async function commitAdvanceAndBalance({ advance, transporterId, delta, level }) {
  const now = new Date().toISOString()
  const id = advance.id || makeId('r')
  const b = writeBatch(db)
  b.set(paths.advance(id), { createdAt: now, updatedAt: now, ...advance, id })
  const patch = { runningBalance: increment(Number(delta) || 0), updatedAt: now }
  if (typeof level === 'number') patch.alertedLevel = level
  b.set(paths.transporter(transporterId), patch, { merge: true })
  await b.commit()
  return { id }
}

/**
 * Reverse a payment as an idempotent transaction (P1-5). The reversal has a
 * DETERMINISTIC id (rev_<paymentNo>). The txn first reads that id: if it already
 * exists (double-tap, or two devices), it aborts WITHOUT incrementing — so the
 * money can never be added back twice, even though the plain writeBatch increment
 * is not idempotent on its own.
 */
async function commitReversalAndBalance({ reversal, transporterId, delta, level }) {
  return await runTransaction(db, async (tx) => {
    const ref = paths.advance(reversal.id)
    const snap = await tx.get(ref)
    if (snap.exists()) return { ok: false, reason: 'already' }
    const now = new Date().toISOString()
    tx.set(ref, { createdAt: now, updatedAt: now, ...reversal })
    const patch = { runningBalance: increment(Number(delta) || 0), updatedAt: now }
    if (typeof level === 'number') patch.alertedLevel = level
    tx.set(paths.transporter(transporterId), patch, { merge: true })
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

/** Upload a whole chakkar idempotently (guard = its first row id). */
async function commitChakkarOnce({ inserts, balance }) {
  return await runTransaction(db, (tx) => commitOnceTx(tx, {
    guardRef: paths.entry(inserts[0].id),
    docs: inserts.map(r => ({ ref: paths.entry(r.id), data: r })),
    balance: (balance && balance.transporterId)
      ? { ref: paths.transporter(balance.transporterId), delta: balance.delta, level: balance.level }
      : null,
    increment,
  }))
}

/** Upload an advance idempotently (guard = the advance id). */
async function commitAdvanceOnce({ advance, transporterId, delta, level }) {
  return await runTransaction(db, (tx) => commitOnceTx(tx, {
    guardRef: paths.advance(advance.id),
    docs: [{ ref: paths.advance(advance.id), data: advance }],
    balance: { ref: paths.transporter(transporterId), delta, level },
    increment,
  }))
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

  // Role resolution reads the signed-in user's OWN users/{email} doc only (P1-1)
  // — the access list is no longer whole-collection-readable by every account.
  const myUser = useCloudDoc(authEmail ? () => paths.user(authEmail) : null, normUser, authKey)
  const isBootstrapOwner = OWNER_EMAILS.map(x => x.toLowerCase()).includes(authEmail)
  const amManager = isBootstrapOwner || !!(myUser && (myUser.role === 'owner' || myUser.role === 'manager') && myUser.active !== false)
  // A gaadiwala's trip/payment/settlement reads are scoped to his own transporterId.
  const gTid = (myUser && myUser.role === 'gaadiwala' && myUser.active !== false && !isBootstrapOwner) ? (myUser.transporterId || '') : ''
  const scope = gTid ? { field: 'transporterId', value: gTid } : null

  // Transporters: managers/owner read the WHOLE list; a gaadiwala reads ONLY his
  // OWN transporter doc (P2-1) — he can never see another gaadiwala's name or
  // balance, at the UI or the data level.
  const transportersCol = useCloudCollection(paths.transporters, paths.transporter, normTransporter, authKey, null, reportWriteError, amManager)
  const myTransporter = useCloudDoc(gTid ? () => paths.transporter(gTid) : null, normTransporter, `${authKey}|${gTid}`)
  const transporters = gTid ? { ...transportersCol, list: myTransporter ? [myTransporter] : [] } : transportersCol
  const destinations = useCloudCollection(paths.destinations, paths.destination, normDestination, authKey, null, reportWriteError)
  const logs         = useCloudCollection(paths.logs, paths.logDoc, (r) => r, authKey, null, reportWriteError)

  // Only managers/owner load the WHOLE users list (for Admin / login management);
  // a gaadiwala sees just his own doc, so he never attempts a denied read.
  const usersCol = useCloudCollection(paths.users, paths.user, normUser, authKey, null, reportWriteError, amManager)
  const users = { ...usersCol, list: amManager ? usersCol.list : (myUser ? [myUser] : []) }

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

  const [pending, setPending] = useState(outboxList())

  // Try to upload ONE outbox item. Allocates its reference number lazily at upload
  // time (persisting it back so a retry reuses it, not a fresh number). Returns the
  // result so the caller can show the challan/payment on immediate success. The
  // in-flight guard stops the foreground save and background sync from both running
  // this item (which would allocate two numbers).
  const uploadItem = useCallback(async (item) => {
    if (inFlight.has(item.id)) return { uploaded: false }
    inFlight.add(item.id)
    try {
      if (item.kind === 'advance') {
        let advance = item.advance
        if (!advance.paymentNo) {
          const paymentNo = await allocateNumber('payment')
          advance = { ...advance, paymentNo }
          outboxUpdate({ ...item, advance })
        }
        const res = await commitAdvanceOnce({ advance, transporterId: item.transporterId, delta: item.delta, level: item.level })
        if (res.ok) { outboxRemove(item.id); return { uploaded: true, paymentNo: advance.paymentNo, already: !!res.already } }
        return { uploaded: false }
      }
      // chakkar
      let inserts = item.inserts
      if (item.kind === 'new' && !inserts[0].challanNo) {
        const challan = await allocateNumber('challan')
        inserts = inserts.map(r => ({ ...r, challanNo: challan }))
        outboxUpdate({ ...item, inserts })
      }
      const res = await commitChakkarOnce({ inserts, balance: item.balance })
      if (res.ok) { outboxRemove(item.id); return { uploaded: true, challanNo: inserts[0].challanNo || 0, already: !!res.already } }
      return { uploaded: false }
    } finally { inFlight.delete(item.id) }
  }, [])

  // Audit line written when a DEFERRED item (saved on the phone, then uploaded
  // later) finally reaches the cloud — so the log records the real challan/payment
  // number it got at upload, not the "(pending upload)" placeholder from save time.
  // Fast online saves log their number in the page directly, so they skip this.
  const logUploaded = useCallback((item, res) => {
    if (!res || !res.uploaded || res.already) return
    if (item.kind === 'advance') {
      log('advance.uploaded', `${fmtPayment(res.paymentNo)} ${item.transporterName} ₹${item.amount} (uploaded from phone)`, item.advance?.createdByUser || 'user', item.transporterId)
    } else {
      log('entry.uploaded', `${fmtChallan(res.challanNo)} ${item.transporterName} ₹${item.grand} (uploaded from phone)`, item.by || 'user', item.id)
    }
  }, [log])

  const syncOutbox = useCallback(async () => {
    // Don't fire server transactions while truly offline — they hang, not fail.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setPending(outboxList()); return }
    for (const item of outboxList()) {
      // Items still in the outbox were saved-but-not-yet-uploaded → log the number
      // they receive now (the page logged only "(pending upload)" for them).
      try { const res = await uploadItem(item); logUploaded(item, res) } catch { /* stays queued for the next trigger */ }
    }
    setPending(outboxList())
  }, [uploadItem, logUploaded])

  // Phone-first save: enqueue DURABLY first, then attempt the upload WITHOUT ever
  // blocking the UI. When offline we skip the transaction entirely (it would hang,
  // not fail). When online we race the upload against a 3s cap so an online user
  // still gets the challan/payment back, but an offline/quota user is never stuck.
  const outboxSave = useCallback(async (item) => {
    outboxEnqueue(item)
    setPending(outboxList())
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { uploaded: false }
    let raced = false
    const attempt = uploadItem(item)
      // If the 3s cap already returned (raced) but the upload then succeeds, the page
      // logged "(pending upload)" — so backfill the real number here too.
      .then(r => { setPending(outboxList()); if (raced) logUploaded(item, r); return r })
      .catch(() => { setPending(outboxList()); return { uploaded: false } })
    const timeout = new Promise(res => setTimeout(() => { raced = true; res({ uploaded: false }) }, 3000))
    return await Promise.race([attempt, timeout])
  }, [uploadItem, logUploaded])

  // Flush the outbox once the app is ready, and again whenever the phone reconnects.
  useEffect(() => {
    if (!ready) return
    syncOutbox() // eslint-disable-line react-hooks/set-state-in-effect -- async: setPending only runs after awaits
    const onOnline = () => syncOutbox()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [ready, syncOutbox])

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
    outbox: { pending, save: outboxSave, syncNow: syncOutbox },
    lastUsed: lastUsedStore, log, allocateNumber, settleBatch,
    commitAdvance: commitAdvanceAndBalance,
    commitReversal: commitReversalAndBalance,
    cloud: { connected: !error, error },
  }
  return (
    <FreightCtx.Provider value={value}>
      <PendingUploadBanner pending={pending} onSyncNow={syncOutbox} />
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
