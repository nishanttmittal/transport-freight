# Offline Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make daily chakkar entry AND advance/payment saves durable on the phone the instant Save is tapped, then auto-upload when the connection/quota returns — with no double-counting of balances — plus an owner "pending upload" alert.

**Architecture:** Add a device-local outbox (localStorage via the existing swappable `storage` adapter). Save writes to the outbox FIRST (phone-first), then attempts an idempotent cloud commit. Uploads reuse the exact money logic but through a guard-read transaction (`commitOnceTx`) so a retry can never re-insert rows or re-apply the balance increment. A background sync retries queued items on app-load and on the browser `online` event. A pending-upload banner + one-tap "Notify owner on WhatsApp" gives visibility.

**Tech Stack:** Vite + React + Firebase (Firestore web SDK, `runTransaction`/`increment`), `node:assert` tests via `test-freight.mjs`, gh-pages deploy.

## Global Constraints
- Money math must stay byte-identical online: `node test-freight.mjs` stays green.
- No Firestore rules change. Same collections/writes as today.
- New-chakkar and advance saves become idempotent; owner-edit / Review / settle / reversal paths stay UNCHANGED (`commitBatchGuarded`, `settleBatch`, `commitReversalAndBalance`).
- Deterministic ids: entry `batchId`+row ids and advance id are generated ONCE at Save time and reused on every upload attempt.
- App is feature-frozen; this is an owner-requested bug-fix. Additive only.
- Owner WhatsApp for alert deep-link: `919810013908` (config constant, confirm before wiring).

---

## File Structure
- Create `src/modules/freight/logic/outbox.js` — pure queue over `storage` (enqueue/list/remove/has/update/clear).
- Create `src/modules/freight/logic/idempotent.js` — pure `commitOnceTx(tx, spec)` transaction body (guard-read → write-once).
- Modify `src/modules/freight/FirestoreProvider.jsx` — add `commitChakkarOnce`, `commitAdvanceOnce`, `syncOutbox`, pending state, `outbox` value; mount pending banner; wire `online`/load triggers.
- Modify `src/modules/freight/pages/Entry.jsx` — new-chakkar save routes through `outbox.save`.
- Modify `src/modules/freight/pages/Advances.jsx` — advance save routes through `outbox.save`.
- Create `src/modules/freight/PendingUploadBanner.jsx` — amber pending chip + list + "Upload now" + "Notify owner on WhatsApp".
- Modify `src/modules/freight/config.js` — add `OWNER_WHATSAPP`.
- Modify `test-freight.mjs` — outbox + idempotency unit tests.

---

### Task 1: Pure outbox queue (`logic/outbox.js`)

**Files:**
- Create: `src/modules/freight/logic/outbox.js`
- Test: `test-freight.mjs` (append)

**Interfaces:**
- Produces: `outboxList(): Item[]`, `outboxEnqueue(item): Item[]`, `outboxRemove(id): Item[]`, `outboxUpdate(item): Item[]`, `outboxHas(id): boolean`, `outboxClear(): void`, `outboxEntryRows(): Row[]`. `Item = { id, kind:'new'|'pending'|'advance', ... }`. `outboxEntryRows()` flattens the pending CHAKKAR items' `inserts` into entry-shaped rows tagged `{ pendingUpload:true }` so list views + `findDuplicate` can see not-yet-uploaded chakkars. Backed by the shared `storage` adapter under key `'outbox'`.

- [ ] **Step 1: Write the failing test** — append to `test-freight.mjs`:

```js
// ---- Outbox (offline queue) ----
import { setStorageAdapter } from './src/core/db/storage.js'
import { outboxList, outboxEnqueue, outboxRemove, outboxUpdate, outboxHas, outboxClear }
  from './src/modules/freight/logic/outbox.js'
{
  const mem = {}
  setStorageAdapter({ getRaw: k => (k in mem ? mem[k] : null), setRaw: (k, v) => { mem[k] = v }, remove: k => { delete mem[k] }, keys: () => Object.keys(mem) })
  outboxClear()
  assert.deepEqual(outboxList(), [])
  outboxEnqueue({ id: 'a', kind: 'new', grand: 100 })
  outboxEnqueue({ id: 'b', kind: 'advance', amount: 50 })
  outboxEnqueue({ id: 'a', kind: 'new', grand: 999 })            // dupe id ignored
  assert.equal(outboxList().length, 2)
  assert.ok(outboxHas('a')); assert.ok(!outboxHas('z'))
  outboxUpdate({ id: 'a', kind: 'new', grand: 777 })             // update in place
  assert.equal(outboxList().find(x => x.id === 'a').grand, 777)
  outboxRemove('a')
  assert.equal(outboxList().length, 1); assert.ok(!outboxHas('a'))
  // entry rows: only chakkar inserts, flattened + tagged
  outboxClear()
  outboxEnqueue({ id: 'c1', kind: 'new', inserts: [{ id: 'r1', freight: 100 }, { id: 'r2', freight: 200 }] })
  outboxEnqueue({ id: 'c2', kind: 'pending', inserts: [{ id: 'r3', freight: 300 }] })
  outboxEnqueue({ id: 'p1', kind: 'advance', amount: 50 })   // advances excluded
  const rows = outboxEntryRows()
  assert.equal(rows.length, 3)
  assert.ok(rows.every(r => r.pendingUpload === true))
  assert.deepEqual(rows.map(r => r.id).sort(), ['r1', 'r2', 'r3'])
}
console.log('outbox ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-freight.mjs`
Expected: FAIL — cannot find module `./src/modules/freight/logic/outbox.js`.

- [ ] **Step 3: Write minimal implementation** — `src/modules/freight/logic/outbox.js`:

```js
/**
 * Device-local outbox — the phone-first buffer. A chakkar/advance is written here
 * the instant Save is tapped (before any network), then uploaded when possible.
 * Persisted via the shared, swappable `storage` adapter (localStorage in the app,
 * an in-memory adapter in tests). Items carry deterministic ids so an upload retry
 * overwrites its own docs instead of duplicating.
 */
import { storage } from '../../../core/db/storage'

const KEY = 'outbox'

export function outboxList() { return storage.get(KEY) || [] }

export function outboxEnqueue(item) {
  const list = outboxList()
  if (list.some(x => x.id === item.id)) return list
  const next = [...list, item]
  storage.set(KEY, next)
  return next
}

export function outboxUpdate(item) {
  const next = outboxList().map(x => (x.id === item.id ? item : x))
  storage.set(KEY, next)
  return next
}

export function outboxRemove(id) {
  const next = outboxList().filter(x => x.id !== id)
  storage.set(KEY, next)
  return next
}

export function outboxHas(id) { return outboxList().some(x => x.id === id) }
export function outboxClear() { storage.set(KEY, []) }

/**
 * Pending CHAKKAR rows, flattened + tagged, so the dup-check and list views can
 * see chakkars saved on the phone but not yet uploaded (otherwise a worker who
 * distrusts the banner could re-enter one → two real chakkars → doubled payable).
 * Advances are excluded (no entry rows).
 */
export function outboxEntryRows() {
  return outboxList()
    .filter(x => (x.kind === 'new' || x.kind === 'pending') && Array.isArray(x.inserts))
    .flatMap(x => x.inserts.map(r => ({ ...r, pendingUpload: true })))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-freight.mjs`
Expected: PASS, prints `outbox ok`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/freight/logic/outbox.js test-freight.mjs
git commit -m "feat(freight): device-local outbox queue (offline-safe save)"
```

---

### Task 2: Idempotent commit body (`logic/idempotent.js`)

**Files:**
- Create: `src/modules/freight/logic/idempotent.js`
- Test: `test-freight.mjs` (append)

**Interfaces:**
- Produces: `commitOnceTx(tx, { guardRef, docs, balance, increment }): Promise<{ok:true, already?:boolean}>`.
  - `tx` = Firestore transaction handle (`get(ref)→snap`, `set(ref,data,opts)`). `snap.exists()` boolean.
  - `docs` = `[{ ref, data }]` to insert. `balance` = `{ ref, delta, level }` or null. `increment` = injected fn (real `firebase/firestore` `increment`, or a fake in tests).
  - Reads the guard doc FIRST (Firestore requires reads-before-writes); if it exists, writes NOTHING and returns `{ok:true, already:true}`.

- [ ] **Step 1: Write the failing test** — append to `test-freight.mjs`:

```js
// ---- Idempotent commit body ----
import { commitOnceTx } from './src/modules/freight/logic/idempotent.js'
function fakeTx(exists) {
  const sets = []
  return { sets, get: async () => ({ exists: () => exists }), set: (ref, data, opts) => sets.push({ ref, data, opts }) }
}
const fakeInc = (n) => ({ __inc: n })
{
  // fresh (guard absent): writes 2 docs + 1 balance set with increment
  const tx = fakeTx(false)
  const r = await commitOnceTx(tx, {
    guardRef: 'g',
    docs: [{ ref: 'e1', data: { a: 1 } }, { ref: 'e2', data: { a: 2 } }],
    balance: { ref: 'tr', delta: 500, level: 5000 },
    increment: fakeInc,
  })
  assert.deepEqual(r, { ok: true })
  assert.equal(tx.sets.length, 3)
  const bal = tx.sets.find(s => s.ref === 'tr')
  assert.deepEqual(bal.data.runningBalance, { __inc: 500 })
  assert.equal(bal.data.alertedLevel, 5000)
}
{
  // replay (guard present): writes NOTHING, balance not touched
  const tx = fakeTx(true)
  const r = await commitOnceTx(tx, {
    guardRef: 'g', docs: [{ ref: 'e1', data: { a: 1 } }],
    balance: { ref: 'tr', delta: 500 }, increment: fakeInc,
  })
  assert.deepEqual(r, { ok: true, already: true })
  assert.equal(tx.sets.length, 0)
}
console.log('idempotent ok')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test-freight.mjs`
Expected: FAIL — cannot find module `idempotent.js`.

- [ ] **Step 3: Write minimal implementation** — `src/modules/freight/logic/idempotent.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test-freight.mjs`
Expected: PASS, prints `idempotent ok`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/freight/logic/idempotent.js test-freight.mjs
git commit -m "feat(freight): idempotent guard-read commit body (safe upload retry)"
```

---

### Task 3: Provider — `commitChakkarOnce`, `commitAdvanceOnce`, `syncOutbox`, `outbox` value

**Files:**
- Modify: `src/modules/freight/FirestoreProvider.jsx`

**Interfaces:**
- Consumes: `commitOnceTx` (Task 2); `outboxList/Enqueue/Update/Remove` (Task 1); existing `allocateNumber`, `paths`, `db`, `increment`, `runTransaction`.
- Produces on the context value: `outbox: { pending: Item[], save(item): Promise<{uploaded, challanNo?, paymentNo?}>, syncNow(): Promise<void> }`.
  - Item shapes: chakkar `{ id, kind:'new'|'pending', by, level, transporterId, transporterName, gaadiNumber, date, inserts:[row...], balance:{transporterId,delta,level}|null, grand, createdAt }`; advance `{ id, kind:'advance', transporterId, transporterName, advance:{...paymentNo? }, delta, level, amount, createdAt }`. `id` = the chakkar `batchId` or the advance id.

- [ ] **Step 1: Add imports + idempotent commit fns** — in `FirestoreProvider.jsx`, after the existing `commitBatchGuarded` definition, add module-level functions:

```js
// (top of file, with other imports)
import { commitOnceTx } from './logic/idempotent'
import { outboxList, outboxEnqueue, outboxUpdate, outboxRemove } from './logic/outbox'

// ids currently being uploaded — stops the foreground save and the background
// sync from processing the same item at once (which would burn a challan number).
const inFlight = new Set()

// (module scope, near commitBatchGuarded)
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
```

- [ ] **Step 2: Add pending state + sync + save inside `FirestoreProvider`** — after the `log` useCallback (~line 268), add:

```js
const [pending, setPending] = useState(outboxList())

// Try to upload ONE outbox item. Allocates its number lazily at upload time
// (persisting it back so a retry reuses it, not a fresh number). Returns the
// result so the caller can show the challan/payment on immediate success. The
// in-flight guard prevents the foreground save and background sync from both
// running this item (which would allocate two numbers).
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
      if (res.ok) { outboxRemove(item.id); return { uploaded: true, paymentNo: advance.paymentNo } }
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
    if (res.ok) { outboxRemove(item.id); return { uploaded: true, challanNo: inserts[0].challanNo || 0 } }
    return { uploaded: false }
  } finally { inFlight.delete(item.id) }
}, [])

const syncOutbox = useCallback(async () => {
  // Don't fire server transactions while truly offline — they hang, not fail.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { setPending(outboxList()); return }
  for (const item of outboxList()) {
    try { await uploadItem(item) } catch { /* stays queued */ }
  }
  setPending(outboxList())
}, [uploadItem])

// Phone-first save: enqueue DURABLY first, then attempt the upload WITHOUT ever
// blocking the UI. When offline we skip the transaction entirely (it would hang,
// not fail). When online we race the upload against a 3s cap so an online user
// still gets the challan/payment back, but an offline/quota user is never stuck.
const outboxSave = useCallback(async (item) => {
  outboxEnqueue(item)
  setPending(outboxList())
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { uploaded: false }
  const attempt = uploadItem(item)
    .then(r => { setPending(outboxList()); return r })
    .catch(() => { setPending(outboxList()); return { uploaded: false } })
  const timeout = new Promise(res => setTimeout(() => res({ uploaded: false }), 3000))
  return await Promise.race([attempt, timeout])
}, [uploadItem])
```

- [ ] **Step 3: Trigger sync on load + reconnect** — add an effect after the readiness effect:

```js
useEffect(() => {
  if (!ready) return
  syncOutbox()
  const onOnline = () => syncOutbox()
  window.addEventListener('online', onOnline)
  return () => window.removeEventListener('online', onOnline)
}, [ready, syncOutbox])
```

- [ ] **Step 4: Expose on the context value** — add to the `value` object:

```js
outbox: { pending, save: outboxSave, syncNow: syncOutbox },
```

- [ ] **Step 5: Verify build + tests**

Run: `node test-freight.mjs && npm run build`
Expected: tests print `outbox ok` / `idempotent ok`; `npm run build` succeeds (bundle written).

- [ ] **Step 6: Commit**

```bash
git add src/modules/freight/FirestoreProvider.jsx
git commit -m "feat(freight): provider outbox save + idempotent upload + auto-sync"
```

---

### Task 4: Route new-chakkar save through the outbox (`Entry.jsx`)

**Files:**
- Modify: `src/modules/freight/pages/Entry.jsx` (the NEW-chakkar branch only, ~lines 124-169; edit branch UNCHANGED)

**Interfaces:**
- Consumes: `outbox.save` (Task 3). Replaces the direct `allocateNumber('challan')` + `entries.commitBatch(...)` in the new-chakkar path.

- [ ] **Step 1: Pull `outbox` from context + import pending rows** — change the destructure on line 26 and add the outbox import at the top of the file:

```js
import { outboxEntryRows } from '../logic/outbox'
// ...
const { transporters, destinations, entries, settlements, lastUsed, logs, log, outbox } = useFreight()
```
(`allocateNumber` no longer needed here; remove it from the destructure.)

- [ ] **Step 1b: Dup-check must see not-yet-uploaded chakkars** — change the `findDuplicate` call (the `const dup = ...` line in the new-chakkar branch) to include pending outbox rows, so a worker re-typing a chakkar that's saved-on-phone-but-not-uploaded still gets the "Possible duplicate?" confirm (otherwise it would upload as a second real chakkar → doubled payable):

```js
const dup = findDuplicate([...entries.list, ...outboxEntryRows()], { transporterId: veh.transporterId, gaadiNumber: veh.gaadiNumber.trim(), date: veh.date, ...drops[0], destinationId: drops[0].destinationId })
```

Pending items are ALSO surfaced app-wide by the persistent PendingUploadBanner (Task 6, visible on every screen incl. the entry screen), which satisfies the "show pending in the relevant list" requirement; the dup-check above is the hard guard against re-entry doubling.

- [ ] **Step 2: Replace the new-chakkar try-block body** — replace the block from `setBusy(true)` after the dup check through its `catch/finally` (the second `try` in `save`, building `bId`/`challan`/`inserts` and awaiting `entries.commitBatch`) with:

```js
    setBusy(true)
    try {
      const bId = makeId('batch')
      let grand = 0
      const inserts = drops.map((d) => {
        const rec = {
          id: makeId('r'),
          date: veh.date, challanNo: 0, status: pendingMode ? 'pending' : 'passed', revision: 0,
          submittedBy: by || '', transporterName: gName, transporterId: veh.transporterId,
          gaadiNumber: veh.gaadiNumber.trim(), ...rowFields(d),
          batchId: bId, createdByRole: level || '', createdByUser: by || '',
          sourceApp: 'transportfreight', workflowStage: 'transport', factoryId: 'main', deleted: false,
        }
        grand += entryTotal(rec)
        return rec
      })
      const bh = pendingMode ? null : balanceHint(transporters, veh.transporterId, +grand)
      const item = {
        id: bId, kind: pendingMode ? 'pending' : 'new', by, level,
        transporterId: veh.transporterId, transporterName: gName, gaadiNumber: veh.gaadiNumber.trim(),
        date: veh.date, inserts, grand,
        balance: bh ? { transporterId: veh.transporterId, delta: +grand, level: bh.level } : null,
        createdAt: new Date().toISOString(),
      }
      const res = await outbox.save(item)
      const n = drops.length
      lastUsed.set({ ...(lastUsed.get() || {}), gaadiNumber: veh.gaadiNumber })
      if (pendingMode) {
        log('entry.submit', `${gName} ${fmtDate(veh.date)} ₹${grand} · ${n} drop${n > 1 ? 's' : ''}`, by, bId)
        logs.insert(auditLine('entry.submit', { by, role: level, after: { total: grand, drops: n }, device: navigator.userAgent }))
        setVeh({ date: veh.date, transporterId: lockTransporterId || '', gaadiNumber: '' })
        setDrops([emptyDrop()])
        show(res.uploaded ? `Sent for approval ✓ · ${n} drop${n > 1 ? 's' : ''}` : `Saved on your phone ✓ — will upload when online`, 3000)
      } else {
        log('entry.add', `${res.challanNo ? fmtChallan(res.challanNo) : '(pending upload)'} ${fmtDate(veh.date)} ₹${grand} · ${n} drop${n > 1 ? 's' : ''}`, by, bId)
        logs.insert(auditLine('entry.add', { by, role: level, after: { challanNo: res.challanNo || 0, total: grand, drops: n }, device: navigator.userAgent }))
        setVeh({ date: veh.date, transporterId: '', gaadiNumber: '' })
        setDrops([emptyDrop()])
        show(res.uploaded ? `Saved ${fmtChallan(res.challanNo)} · ${n} drop${n > 1 ? 's' : ''} ✓` : `Saved on your phone ✓ — will upload when online`, 3000)
      }
    } catch { show('Could not save — check internet and try again', 2600) } finally { setBusy(false) }
  }
```

Note: the header challan preview (`nextChallanNo`, line 43 / 185) is display-only and stays; offline chakkars simply get their real number at upload.

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: build OK; lint shows only the pre-existing react-refresh warning on `useFreight` (no new errors).

- [ ] **Step 4: Commit**

```bash
git add src/modules/freight/pages/Entry.jsx
git commit -m "feat(freight): new-chakkar save is phone-first via outbox"
```

---

### Task 5: Route advance save through the outbox (`Advances.jsx`)

**Files:**
- Modify: `src/modules/freight/pages/Advances.jsx` (the `save` fn ~lines 30-46; `reverse` UNCHANGED)

**Interfaces:**
- Consumes: `outbox.save` (Task 3). Replaces `allocateNumber('payment')` + `commitAdvance(...)`.

- [ ] **Step 1: Pull `outbox` from context** — change line 19:

```js
const { transporters, advances, settlements, logs, log, commitReversal, outbox } = useFreight()
```
(`allocateNumber` and `commitAdvance` no longer used in `save`; `commitReversal` stays for `reverse`.)

- [ ] **Step 2: Replace the `save` try-block** — replace the body of the `try` (allocate payment → build rec → `commitAdvance`) with:

```js
    setBusy(true)
    try {
      const id = makeId('r')
      const lvl = balanceHint(transporters, form.transporterId, -amt).level
      const rec = { id, date: form.date, transporterId: form.transporterId, transporterName: tName(form.transporterId), amount: amt, paidBy: form.paidBy, note: form.note.trim(), paymentNo: 0, reversal: false, reversed: false, factoryId: 'main', deleted: false, createdByUser: by || '' }
      const item = { id, kind: 'advance', transporterId: form.transporterId, transporterName: tName(form.transporterId), advance: rec, delta: -amt, level: lvl, amount: amt, createdAt: new Date().toISOString() }
      const res = await outbox.save(item)
      log('advance.add', `${res.paymentNo ? fmtPayment(res.paymentNo) : '(pending upload)'} ${tName(form.transporterId)} ₹${amt} by ${form.paidBy}`, by, form.transporterId)
      audit({ action: 'payment.add', by, role: level, after: { ...rec, paymentNo: res.paymentNo || 0 } })
      setForm({ ...form, amount: '', note: '' })
      show(res.uploaded ? `Saved ${fmtPayment(res.paymentNo)} ✓` : 'Saved on your phone ✓ — will upload when online', 3000)
    } catch { show('Could not save — check internet and try again', 2600) } finally { setBusy(false) }
```

Ensure `makeId` and `balanceHint` are imported in this file (add to the existing imports if missing — `makeId` from `../../../core/db/repository`, `balanceHint` from `../logic/calc` matching Entry.jsx's import path).

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: build OK; no new lint errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/freight/pages/Advances.jsx
git commit -m "feat(freight): advance save is phone-first via outbox"
```

---

### Task 6: Pending-upload banner + owner WhatsApp alert

**Files:**
- Create: `src/modules/freight/PendingUploadBanner.jsx`
- Modify: `src/modules/freight/config.js` (add `OWNER_WHATSAPP`)
- Modify: `src/modules/freight/FirestoreProvider.jsx` (render the banner alongside the existing writeError banner)

**Interfaces:**
- Consumes: `outbox.pending`, `outbox.syncNow` (Task 3); `OWNER_WHATSAPP`.

- [ ] **Step 1: Add owner WhatsApp constant** — in `config.js`:

```js
/** Owner WhatsApp (E.164, no +) for the "pending upload" alert deep-link. */
export const OWNER_WHATSAPP = '919810013908'
```

- [ ] **Step 2: Create the banner** — `src/modules/freight/PendingUploadBanner.jsx`:

```js
/**
 * Shows when chakkars/advances are saved on this phone but not yet uploaded. Gives
 * the enterer certainty the data is safe + a one-tap way to tell the owner (a
 * wa.me deep link — no secret shipped in this public app). "Upload now" retries.
 */
import { useState } from 'react'
import { OWNER_WHATSAPP } from './config'

export default function PendingUploadBanner({ pending = [], onSyncNow }) {
  const [open, setOpen] = useState(false)
  if (!pending.length) return null
  const n = pending.length
  const summary = pending.map(p => p.kind === 'advance'
    ? `payment ₹${p.amount} to ${p.transporterName}`
    : `${p.grand ? '₹' + p.grand : 'chakkar'} ${p.transporterName || ''}`.trim()).join(', ')
  const msg = encodeURIComponent(`UNICO Freight: ${n} entry(s) saved on the phone that haven't uploaded yet (no internet / server busy): ${summary}. They'll upload automatically when possible.`)
  const waHref = `https://wa.me/${OWNER_WHATSAPP}?text=${msg}`
  return (
    <div className="fixed top-0 inset-x-0 z-40 bg-amber-500 text-amber-950 text-sm shadow-lg"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="px-4 py-2.5 flex items-center gap-3">
        <button className="flex-1 text-left font-bold" onClick={() => setOpen(o => !o)}>
          ⬆️ {n} saved on phone — not uploaded yet {open ? '▲' : '▼'}
        </button>
        <button onClick={onSyncNow} className="font-bold bg-amber-950/15 rounded-lg px-3 py-1">Upload now</button>
        <a href={waHref} target="_blank" rel="noreferrer" className="font-bold bg-green-600 text-white rounded-lg px-3 py-1">Notify owner</a>
      </div>
      {open && (
        <div className="px-4 pb-2.5 space-y-1">
          {pending.map(p => (
            <div key={p.id} className="text-xs bg-amber-950/10 rounded-lg px-3 py-1.5">
              {p.kind === 'advance'
                ? `Payment ₹${p.amount} → ${p.transporterName}`
                : `${p.transporterName || 'Chakkar'} · ${p.date} · ₹${p.grand}`}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Render it in the provider** — in `FirestoreProvider.jsx`, import and render above the writeError banner inside the returned `FreightCtx.Provider`:

```js
import PendingUploadBanner from './PendingUploadBanner'
// ...
<FreightCtx.Provider value={value}>
  <PendingUploadBanner pending={pending} onSyncNow={syncOutbox} />
  {writeError && ( /* ...existing red banner... */ )}
  {children}
</FreightCtx.Provider>
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add src/modules/freight/PendingUploadBanner.jsx src/modules/freight/config.js src/modules/freight/FirestoreProvider.jsx
git commit -m "feat(freight): pending-upload banner + one-tap owner WhatsApp alert"
```

---

### Task 7: Full-gate verification + deploy

**Files:** none (verification/deploy).

- [ ] **Step 1: Run the whole gate**

Run: `node test-freight.mjs && npm run build && npm run lint`
Expected: all tests pass (incl. `outbox ok`, `idempotent ok`); build OK; only the pre-existing react-refresh lint warning.

- [ ] **Step 2: Local device dry-run (headless sanity)** — `npm run dev`, load in a browser, sign in; DevTools → Network → Offline → save a chakkar and an advance → confirm the amber "2 saved on phone" banner + calm toast; Network → Online → confirm both upload (challan/payment appear, banner clears). Confirm balance moved exactly once (Admin → Recalculate = no change).

- [ ] **Step 3: Deploy**

Run: `npm run deploy` then nudge the Pages build:
```bash
curl -s -X POST -H "Authorization: token $(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/nishanttmittal/transport-freight/pages/builds
```
Verify the new asset hash from `dist/index.html` serves HTTP 200 at `https://nishanttmittal.github.io/transport-freight/`.

- [ ] **Step 4: Commit any deploy metadata + push**

```bash
git push origin master
```

- [ ] **Step 5: Owner device-test (the real gate)** — hand to owner/Anshul: airplane-mode → save a chakkar + an advance → see them held on the phone + "Notify owner" → reconnect → both auto-upload with numbers, balance correct. Then re-enter the 9-July lost chakkars.

---

## Self-Review
- **Spec coverage:** outbox (§1)→T1; idempotent upload (§3)→T2/T3; chakkar save (§2)→T4; advance save (§5b)→T3/T5; auto-sync (§4)→T3; pending UI (§5)→T6; owner alert (§6 Phase-1)→T6; testing (§Testing)→T1/T2/T7. Phase-2 auto-relay is explicitly deferred (not a task). ✅
- **Placeholders:** none — every code step is complete.
- **Type consistency:** `outbox.save`/`syncNow`/`pending` names match across T3/T4/T5/T6; `commitOnceTx` signature matches T2 test + T3 callers; item `kind` values `'new'|'pending'|'advance'` consistent; `res.uploaded/challanNo/paymentNo` returned by `uploadItem` and consumed in T4/T5.
- **Advisor fixes folded in:** (1) BLOCKER — save never `await`s a transaction on the critical path: `outboxSave` returns immediately, pre-gates on `navigator.onLine`, and races the online attempt against a 3s cap (T3), so the pure-offline case can't hang the UI. (2) Duplicate-entry hole — `outboxEntryRows()` feeds `findDuplicate` (T4 Step 1b) and the persistent banner surfaces pending items app-wide (T6). (3) Minor — in-flight `Set` stops foreground+sync double-processing / challan burn (T3). Stale `alertedLevel` hint left as-is (cosmetic; drives only the toast; Admin→Recalculate is the exact net) — the `increment` money stays correct.
