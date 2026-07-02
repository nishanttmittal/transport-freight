# Transport Freight — Approval Workflow Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approval machinery — entry `status`, atomic challan/payment/settlement numbers, before→after audit, optimistic concurrency, Cancel-not-delete, reversing-entry payment reversals, and a manager approval home — to the LIVE transport-freight app, **without gaadiwala logins yet** and **without breaking the current staff flow or any saved data**.

**Architecture:** Extend the existing `src/modules/freight` module. All money/state math is added as **pure functions** in `logic/` and covered by the plain-node test harness `test-freight.mjs` (this app has no React test runner — Vite build is the UI gate, per CLAUDE.md). Firestore stays the flat layout in the shared `unico-operations` project; number allocation uses a client-initiated **Firestore transaction** (server-atomic) on a counter doc. UI changes wire the pure logic into existing pages plus one new Approval-home/queue.

**Tech Stack:** Vite + React 18 + Firebase (Firestore) + jspdf. Node ESM test script. gh-pages deploy (`--dotfiles --nojekyll`, iPhone hotspot only — GitHub blocked on factory wifi).

## Global Constraints

- App namespace `apps/transportfreight/*` in shared `unico-operations` Firestore. Flat layout — **no data migration.**
- Additive & back-compatible only. `makeNormalizer` backfills new fields on read; **existing rows must keep working** (default `status = 'passed'`, `revision = 0`).
- Balance/hisab counts **only** `status === 'passed'` and not deleted. `pending | needs_correction | voided | cancelled` never count.
- Numbers are **display references**, continuous: `TF-0001`, `PAY-0001`, `SET-0001`. Allocated **only** inside a Firestore transaction on `apps/transportfreight/meta/counters` — never "max seen on client". A gap (from a later Cancel/Void) is retained, never reused.
- Money fields are whole ₹; guard every read with `Number(v) || 0`.
- No hard-delete of a **passed** record — it becomes `status:'cancelled'` (reason mandatory), balance reversed. Pending/needs_correction may be soft-deleted (`deleted:true`).
- Soft-delete only; preserve history. Every state change writes a `logs` line with `before`→`after`.
- Deploy always `gh-pages -d dist --dotfiles --nojekyll`; keep `public/.nojekyll`.
- The money-logic gate is `node test-freight.mjs`; the UI gate is `npm run build` (+ `npm run lint`). Verify a real device load after risky UI changes.
- Spec of record: `docs/superpowers/specs/2026-06-30-approval-roles-design.md`.

---

### Task 1: Entry `status` + hisab counts passed-only

**Files:**
- Modify: `src/modules/freight/schema.js` (entrySchema)
- Modify: `src/modules/freight/logic/calc.js` (`transporterTotals`, `ledgerLines`)
- Test: `test-freight.mjs`

**Interfaces:**
- Produces: `STATUS` constants and `countsInHisab(entry) -> boolean`; `transporterTotals`/`ledgerLines` now include only `countsInHisab` rows.
- Consumes: existing `entryTotal`.

- [ ] **Step 1: Add the failing test** — append to `test-freight.mjs`:

```javascript
import { countsInHisab, STATUS } from './src/modules/freight/logic/status.js'

// only PASSED (or legacy no-status) count in the hisab
assert.equal(countsInHisab({ status: 'passed' }), true)
assert.equal(countsInHisab({}), true)                       // legacy row, no status → counts
assert.equal(countsInHisab({ status: 'pending' }), false)
assert.equal(countsInHisab({ status: 'voided' }), false)
assert.equal(countsInHisab({ status: 'cancelled' }), false)
assert.equal(countsInHisab({ status: 'passed', deleted: true }), false)

// transporterTotals ignores non-passed rows
const tEntries = [
  { transporterId: 't1', date: '2026-07-01', status: 'passed',  freight: 1000 },
  { transporterId: 't1', date: '2026-07-01', status: 'pending', freight: 5000 },
  { transporterId: 't1', date: '2026-07-01', status: 'cancelled', freight: 9000 },
]
const ttp = transporterTotals(tEntries, [], 't1', {})
assert.equal(ttp.freight, 1000)   // only the passed one
```

- [ ] **Step 2: Run — expect FAIL** — `cd ~/transport-freight && node test-freight.mjs` → fails (`status.js` missing). Add `import { transporterTotals } ...` already present at top of test.

- [ ] **Step 3: Create `src/modules/freight/logic/status.js`**

```javascript
/** Chakkar approval states. Legacy rows (no status) are treated as 'passed'. */
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
```

- [ ] **Step 4: Gate `calc.js` on `countsInHisab`** — in `logic/calc.js`, import `countsInHisab` and replace the freight-row filters:
  - In `transporterTotals`, the entry loop condition becomes: `if (e.transporterId !== transporterId || !countsInHisab(e)) continue` (drop the old `e.deleted` check — `countsInHisab` covers it).
  - In `ledgerLines`, the freight loop condition becomes: `if (e.transporterId !== transporterId || !countsInHisab(e) || !inRange(e.date)) continue`.

- [ ] **Step 5: Add `status` to `entrySchema`** — in `schema.js`, after the `date`/`challanNo` fields add:

```javascript
  field({ name: 'status',   label: 'Status',   type: 'text',   default: 'passed', inList: false }),
  field({ name: 'revision', label: 'Revision', type: 'number', default: 0, inList: false }),
```

- [ ] **Step 6: Run — expect PASS** — `node test-freight.mjs` → `ALL FREIGHT CALC TESTS PASSED`. Then `npm run build` → passes.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(stage1): entry status + hisab counts passed-only"
```

---

### Task 2: State transitions (pass / void / return / cancel)

**Files:**
- Modify: `src/modules/freight/logic/status.js`
- Test: `test-freight.mjs`

**Interfaces:**
- Produces: `applyTransition(entry, action, ctx) -> { ...entry, ...changes }` where `action ∈ {'pass','void','return','cancel','resubmit'}` and `ctx = { by, role, reason, challanNo }`. Throws on an illegal transition or a missing mandatory reason.

- [ ] **Step 1: Failing test** — append:

```javascript
import { applyTransition } from './src/modules/freight/logic/status.js'

// pass a pending → passed, stamps challan + approver
const passed = applyTransition({ status: 'pending', revision: 0 }, 'pass', { by: 'Anshul', role: 'manager', challanNo: 7 })
assert.equal(passed.status, 'passed'); assert.equal(passed.challanNo, 7); assert.equal(passed.approvedBy, 'Anshul')

// void requires a reason
assert.throws(() => applyTransition({ status: 'pending' }, 'void', { by: 'Anshul' }), /reason/i)
const voided = applyTransition({ status: 'pending' }, 'void', { by: 'Anshul', reason: 'duplicate' })
assert.equal(voided.status, 'voided'); assert.equal(voided.voidReason, 'duplicate')

// return requires a reason, goes to needs_correction
const ret = applyTransition({ status: 'pending' }, 'return', { by: 'Anshul', reason: 'wrong amount' })
assert.equal(ret.status, 'needs_correction'); assert.equal(ret.correctionReason, 'wrong amount')

// cancel a passed requires reason, keeps it in ledger as cancelled
assert.throws(() => applyTransition({ status: 'passed' }, 'cancel', { by: 'N' }), /reason/i)
const canc = applyTransition({ status: 'passed', challanNo: 7 }, 'cancel', { by: 'Nishant', reason: 'wrong trip' })
assert.equal(canc.status, 'cancelled'); assert.equal(canc.cancelReason, 'wrong trip'); assert.equal(canc.challanNo, 7)

// illegal: cannot pass a cancelled
assert.throws(() => applyTransition({ status: 'cancelled' }, 'pass', {}), /illegal|cannot/i)
```

- [ ] **Step 2: Run — expect FAIL** (`applyTransition` undefined).

- [ ] **Step 3: Implement in `status.js`**

```javascript
const now = () => new Date().toISOString()
const need = (v, msg) => { if (!v || !String(v).trim()) throw new Error(msg) }

/** Legal transitions keyed by current status. */
const ALLOWED = {
  pending:          ['pass', 'void', 'return'],
  needs_correction: ['resubmit', 'void'],
  passed:           ['cancel'],
  voided:           [],
  cancelled:        [],
}

export function applyTransition(entry, action, ctx = {}) {
  const cur = entry.status || STATUS.passed
  if (!(ALLOWED[cur] || []).includes(action)) {
    throw new Error(`illegal transition: cannot ${action} a ${cur} chakkar`)
  }
  const base = { ...entry, updatedAt: now() }
  switch (action) {
    case 'pass':
      return { ...base, status: STATUS.passed, approvedBy: ctx.by || '', approvedAt: now(), challanNo: Number(ctx.challanNo) || entry.challanNo || 0 }
    case 'void':
      need(ctx.reason, 'void reason is required')
      return { ...base, status: STATUS.voided, voidReason: ctx.reason }
    case 'return':
      need(ctx.reason, 'correction reason is required')
      return { ...base, status: STATUS.needs_correction, correctionReason: ctx.reason }
    case 'resubmit':
      return { ...base, status: STATUS.pending, correctionReason: '' }
    case 'cancel':
      need(ctx.reason, 'cancel reason is required')
      return { ...base, status: STATUS.cancelled, cancelReason: ctx.reason }
    default:
      throw new Error(`unknown action ${action}`)
  }
}
```

- [ ] **Step 4: Run — expect PASS.** `node test-freight.mjs`.

- [ ] **Step 5: Add the reason fields to `entrySchema`** (so they persist & normalize):

```javascript
  field({ name: 'submittedBy',      label: 'Submitted By',  default: '', inList: false }),
  field({ name: 'approvedBy',       label: 'Approved By',   default: '', inList: false }),
  field({ name: 'approvedAt',       label: 'Approved At',   default: '', inList: false }),
  field({ name: 'voidReason',       label: 'Void Reason',   default: '', inList: false }),
  field({ name: 'correctionReason', label: 'Correction',    default: '', inList: false }),
  field({ name: 'cancelReason',     label: 'Cancel Reason', default: '', inList: false }),
  field({ name: 'adjustsChallanNo', label: 'Adjusts',       type: 'number', default: 0, inList: false }),
  field({ name: 'transporterName',  label: 'Gaadiwala Name', default: '', inList: false }),
```

- [ ] **Step 6: Build + commit** — `npm run build`; `git add -A && git commit -m "feat(stage1): chakkar state transitions"`

---

### Task 3: Atomic number allocation (challan / payment / settlement)

**Files:**
- Create: `src/modules/freight/logic/counters.js`
- Modify: `src/modules/freight/FirestoreProvider.jsx` (expose `allocateNumber`)
- Modify: `src/modules/freight/FreightContext.jsx` (local fallback `allocateNumber`)
- Test: `test-freight.mjs` (pure part only)

**Interfaces:**
- Produces: `nextFromCounters(countersDoc, kind, start) -> number` (pure); and a context method `allocateNumber(kind) -> Promise<number>` that runs a Firestore transaction on `apps/transportfreight/meta/counters`. `kind ∈ {'challan','payment','settlement'}`.
- Consumes: `db` from `core/db/firebase`, `runTransaction`, `doc` from `firebase/firestore`.

- [ ] **Step 1: Failing test (pure allocation math)** — append:

```javascript
import { nextFromCounters } from './src/modules/freight/logic/counters.js'
assert.equal(nextFromCounters({}, 'challan', 1), 1)              // fresh → start
assert.equal(nextFromCounters({ challan: 5 }, 'challan', 1), 6)  // last+1
assert.equal(nextFromCounters({ challan: 2 }, 'challan', 1000), 1000) // start wins when higher
assert.equal(nextFromCounters({ payment: 9 }, 'challan', 1), 1)  // independent kinds
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `counters.js` (pure part)**

```javascript
/** Pure next-number given the current counters doc. Kinds: challan|payment|settlement. */
export function nextFromCounters(counters, kind, start = 1) {
  const last = Number((counters || {})[kind]) || 0
  return Math.max(last + 1, start)
}

export const COUNTER_START = { challan: 1, payment: 1, settlement: 1 }
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Add the transaction allocator to `FirestoreProvider.jsx`** — import `runTransaction, doc` from `firebase/firestore` and `db` from `core/db/firebase`; the counters doc path is `apps/${APP_NS}/meta/counters` (build with the same `paths` helper style already used). Add:

```javascript
import { runTransaction, doc } from 'firebase/firestore'
import { nextFromCounters, COUNTER_START } from './logic/counters'
// counters live at apps/<ns>/meta/counters — reuse the same base path as other collections
const countersRef = () => doc(db, `apps/transportfreight/meta/counters`)

async function allocateNumber(kind) {
  return await runTransaction(db, async (tx) => {
    const ref = countersRef()
    const snap = await tx.get(ref)
    const cur = snap.exists() ? snap.data() : {}
    const next = nextFromCounters(cur, kind, COUNTER_START[kind])
    tx.set(ref, { [kind]: next }, { merge: true })
    return next
  })
}
```
  Add `allocateNumber` to the context `value` object exported by `FirestoreProvider`.

- [ ] **Step 6: Local fallback** — in `FreightContext.jsx` `LocalFreightProvider`, add an `allocateNumber` that reads/writes a `lastUsedStore`-backed counter (offline mode has no transactions): `const allocateNumber = async (kind) => { const c = lastUsedStore.get() || {}; const n = nextFromCounters(c.counters || {}, kind, COUNTER_START[kind]); lastUsedStore.set({ ...c, counters: { ...(c.counters||{}), [kind]: n } }); return n }`. Add to the local `value`. Import `nextFromCounters, COUNTER_START`.

- [ ] **Step 7: Rules — allow counter writes for manager/owner** — this is applied in Task 9 of Stage 3 (rules rewrite). For Stage 1 the existing "any signed-in" rule already permits it; note it here so it isn't forgotten.

- [ ] **Step 8: Build + commit** — `npm run build`; `git commit -m "feat(stage1): atomic number allocation via firestore transaction"`

---

### Task 4: Optimistic concurrency (revision guard)

**Files:**
- Modify: `src/modules/freight/logic/status.js`
- Modify: `src/modules/freight/FirestoreProvider.jsx` (guarded update helper)
- Test: `test-freight.mjs`

**Interfaces:**
- Produces: `isStale(expectedRevision, actualRevision) -> boolean`; a context method `updateGuarded(collection, id, expectedRevision, patch) -> Promise<{ok:boolean, reason?:string}>` that fails if the stored `revision` moved on, else writes `patch` with `revision+1`.

- [ ] **Step 1: Failing test** — append:

```javascript
import { isStale } from './src/modules/freight/logic/status.js'
assert.equal(isStale(3, 3), false) // same → fresh
assert.equal(isStale(2, 3), true)  // someone else bumped it → stale
assert.equal(isStale(0, 0), false)
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `isStale` in `status.js`**

```javascript
export function isStale(expected, actual) {
  return (Number(expected) || 0) !== (Number(actual) || 0)
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: `updateGuarded` in `FirestoreProvider.jsx`** — a transaction that re-reads the doc and rejects if stale:

```javascript
async function updateGuarded(collPathFn, docPathFn, id, expectedRevision, patch) {
  return await runTransaction(db, async (tx) => {
    const ref = docPathFn(id)
    const snap = await tx.get(ref)
    const actual = snap.exists() ? (Number(snap.data().revision) || 0) : 0
    if (isStale(expectedRevision, actual)) return { ok: false, reason: 'stale' }
    tx.set(ref, { ...patch, revision: actual + 1, updatedAt: new Date().toISOString() }, { merge: true })
    return { ok: true }
  })
}
```
  Expose `updateGuarded` (bound to the entries collection path) via the entries handle, e.g. `entries.updateGuarded(id, expectedRevision, patch)`. Import `isStale`.

- [ ] **Step 6: Build + commit** — `npm run build`; `git commit -m "feat(stage1): optimistic-concurrency revision guard"`

---

### Task 5: Duplicate detection

**Files:**
- Modify: `src/modules/freight/logic/status.js`
- Test: `test-freight.mjs`

**Interfaces:**
- Produces: `findDuplicate(entries, candidate) -> entry|null` — matches same `transporterId` + `gaadiNumber` + `date` + same total (and same first `destinationId` when the candidate has one), ignoring voided/cancelled/deleted rows.

- [ ] **Step 1: Failing test** — append:

```javascript
import { findDuplicate } from './src/modules/freight/logic/status.js'
const dupExisting = [{ id: 'a', transporterId: 't1', gaadiNumber: '1234', date: '2026-07-01', destinationId: 'd1', status: 'passed', freight: 2500 }]
const cand = { transporterId: 't1', gaadiNumber: '1234', date: '2026-07-01', destinationId: 'd1', freight: 2500 }
assert.ok(findDuplicate(dupExisting, cand))                              // exact dup
assert.equal(findDuplicate(dupExisting, { ...cand, freight: 2600 }), null) // different total
assert.equal(findDuplicate(dupExisting, { ...cand, gaadiNumber: '9999' }), null)
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement in `status.js`** (uses `entryTotal` — import it):

```javascript
import { entryTotal } from './calc.js'

export function findDuplicate(entries, cand) {
  const tot = entryTotal(cand)
  return (entries || []).find(e =>
    !e.deleted && e.status !== STATUS.voided && e.status !== STATUS.cancelled &&
    e.transporterId === cand.transporterId &&
    (e.gaadiNumber || '') === (cand.gaadiNumber || '') &&
    e.date === cand.date &&
    entryTotal(e) === tot &&
    (!cand.destinationId || e.destinationId === cand.destinationId)
  ) || null
}
```
  Note: `status.js` importing from `calc.js` — verify no circular import breaks the build (calc.js must NOT import from status.js at module top for the `findDuplicate` path; it only imports `countsInHisab`. If a cycle warning appears, move `countsInHisab` usage in calc.js to a local re-implementation or split constants into a third file `statusConstants.js`).

- [ ] **Step 4: Run — expect PASS + build.** `node test-freight.mjs && npm run build`.

- [ ] **Step 5: Commit** — `git commit -m "feat(stage1): duplicate-chakkar detection"`

---

### Task 6: Reversing-entry payment reversal

**Files:**
- Modify: `src/modules/freight/schema.js` (advanceSchema)
- Modify: `src/modules/freight/logic/calc.js` (advance summation)
- Modify: `src/modules/freight/logic/status.js` (`makeReversal`)
- Test: `test-freight.mjs`

**Interfaces:**
- Produces: `makeReversal(payment, by) -> reversingRecord` (negative amount, `reversesPaymentNo` set). Advance totals = Σ amount over non-deleted advances (a reversal's negative amount nets it out); the old `reversed` boolean is honoured for legacy rows.

- [ ] **Step 1: Failing test** — append:

```javascript
import { makeReversal } from './src/modules/freight/logic/status.js'
const pay = { id: 'p1', transporterId: 't1', date: '2026-07-01', amount: 500, paymentNo: 3 }
const rev = makeReversal(pay, 'Nishant')
assert.equal(rev.amount, -500); assert.equal(rev.reversesPaymentNo, 3); assert.equal(rev.transporterId, 't1')

// advances net to zero after reversal
const adv = [pay, rev]
const tt2 = transporterTotals([], adv, 't1', {})
assert.equal(tt2.advances, 0)
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: `makeReversal` in `status.js`**

```javascript
export function makeReversal(p, by) {
  return {
    transporterId: p.transporterId, date: new Date().toISOString().slice(0, 10),
    amount: -(Number(p.amount) || 0), paidBy: p.paidBy || '',
    note: `Reversal of PAY-${String(p.paymentNo).padStart(4, '0')}`,
    reversesPaymentNo: Number(p.paymentNo) || 0, reversal: true,
    createdByUser: by || '', deleted: false,
  }
}
```

- [ ] **Step 4: Advance summation** — in `calc.js` `transporterTotals`, the advance loop: keep skipping legacy `a.reversed` and `a.deleted`, but include reversals (negative amounts) so they net out. Condition: `if (a.transporterId !== transporterId || a.reversed || a.deleted) continue` (unchanged — a reversal row has `reversed` falsy and a negative amount, so it correctly subtracts). Confirm the test passes with this.

- [ ] **Step 5: advanceSchema fields** — add `paymentNo` (number, 0), `reversesPaymentNo` (number, 0), `reversal` (toggle, false), `factoryId` ('main'), `transporterName` ('').

- [ ] **Step 6: Run + build + commit** — `node test-freight.mjs && npm run build`; `git commit -m "feat(stage1): reversing-entry payment reversal + payment number field"`

---

### Task 7: Audit log helper

**Files:**
- Create: `src/modules/freight/logic/audit.js`
- Test: `test-freight.mjs`

**Interfaces:**
- Produces: `auditLine(action, { by, role, reason, before, after }) -> logRecord` with `ts`, `action`, `by`, `role`, `reason`, `device` (caller passes `navigator.userAgent`), `before`, `after`. Pure (device passed in).

- [ ] **Step 1: Failing test** — append:

```javascript
import { auditLine } from './src/modules/freight/logic/audit.js'
const a = auditLine('entry.pass', { by: 'Anshul', role: 'manager', reason: '', before: { freight: 100 }, after: { freight: 100, status: 'passed' }, device: 'jest' })
assert.equal(a.action, 'entry.pass'); assert.equal(a.by, 'Anshul'); assert.deepEqual(a.after, { freight: 100, status: 'passed' }); assert.ok(a.ts)
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `audit.js`**

```javascript
/** Build one append-only audit line. `device` = navigator.userAgent (passed by caller). */
export function auditLine(action, { by = '', role = '', reason = '', before = null, after = null, device = '' } = {}) {
  return { ts: new Date().toISOString(), action, by, role, reason, device, before, after }
}
```

- [ ] **Step 4: Run — expect PASS + commit** — `node test-freight.mjs`; `git commit -m "feat(stage1): audit-line helper"`

---

### Task 8: Wire logic into Entry + payment save (snapshots, numbers, dup warning, audit)

**Files:**
- Modify: `src/modules/freight/pages/Entry.jsx`
- Modify: `src/modules/freight/pages/Advances.jsx`

**Interfaces:**
- Consumes: `applyTransition`, `findDuplicate`, `makeReversal`, `auditLine` (status/audit), `allocateNumber` (context), `entryTotal`.

- [ ] **Step 1: Entry — status + snapshot + number on save** — in `Entry.jsx` `save()`:
  - Stamp `status: 'passed'` and `submittedBy: by`, `transporterName: <selected gaadiwala name>`, `revision: 0` on each drop rec (staff entry stays direct-passed in Stage 1).
  - Replace the current `challanNo` (from `nextChallanNo`) with an **awaited** `const challan = await allocateNumber('challan')` (make `save` async); stamp `challanNo: challan` on all drops of the batch. Keep the on-screen preview badge using `nextChallanNo` (display only — clearly labelled "next").
  - After insert, `log('entry.add', …)` stays; additionally push an `auditLine('entry.add', { by, role: level, after: rec, device: navigator.userAgent })` into `logs`.
- [ ] **Step 2: Entry — duplicate warning** — before saving, compute `const dup = findDuplicate(entries.list, firstDrop)`; if found, `window.confirm('Possible duplicate of TF-… (same gaadi, date, amount). Save anyway?')`; on cancel, abort. Non-blocking.
- [ ] **Step 3: Advances — payment number + snapshot** — in `Advances.jsx` save: `const no = await allocateNumber('payment')`; stamp `paymentNo: no`, `transporterName`, `factoryId: 'main'`. Show `PAY-####` in the list and toast.
- [ ] **Step 4: Advances — reversal via reversing entry** — replace the current "reverse" (which set `reversed:true`) with: insert `makeReversal(payment, by)` as a NEW advance, and `applyBalance(transporters, tId, +amount)` (reversal adds the money back to balance). Keep the original untouched. Audit `payment.reverse`.
- [ ] **Step 5: Build + dev check** — `npm run build`; `npm run dev`: add gaadiwala+transport, save a multi-drop entry → challan `TF-0001`; save the same again → duplicate warning; record a payment → `PAY-0001`; reverse it → a `-₹` reversing line and balance restored.
- [ ] **Step 6: Commit** — `git commit -m "feat(stage1): wire numbers/snapshot/dup-warning/reversal into entry + advances"`

---

### Task 9: Approval home + review queue + Cancel

**Files:**
- Create: `src/modules/freight/pages/Review.jsx`
- Modify: `src/modules/freight/manifest.jsx` (register Review page + HomeStats worklist)
- Modify: `src/modules/freight/pages/Hisab.jsx` (Cancel replaces any delete of a passed row)

**Interfaces:**
- Consumes: `applyTransition`, `allocateNumber`, `auditLine`, `updateGuarded`, `STATUS`, `fmtChallan`.

- [ ] **Step 1: Review page** — lists entries with `status ∈ {pending, needs_correction}` (empty until Stage 2's gaadiwala login — that's expected). Each row: gaadiwala, date, drops, total, and buttons **Pass / Return / Void**.
  - **Pass:** `const c = await allocateNumber('challan'); const next = applyTransition(entry, 'pass', { by, role, challanNo: c }); await entries.updateGuarded(id, entry.revision, next)`; on `{ok:false}` toast "Refresh — changed by someone else"; on success `applyBalance(+total)` and audit `entry.pass`.
  - **Return / Void:** prompt for a **mandatory** reason (block empty); `applyTransition(entry,'return'|'void',{by,role,reason})` via `updateGuarded`; audit.
- [ ] **Step 2: HomeStats worklist** — in `manifest.jsx` `HomeStats`, show today's counts: Pending, Needs-correction, Approved-today, Voided-today, plus Total outstanding (Σ transporter `runningBalance`). Add a `review` page entry (`roles:['incharge','owner']`, icon 🕒, title "Approvals").
- [ ] **Step 3: Cancel a passed entry** — anywhere a passed entry can be removed (Hisab/admin), replace hard/soft delete with: prompt mandatory reason → `applyTransition(entry,'cancel',{by,role,reason})` via `updateGuarded` → `applyBalance(-total)` → audit `entry.cancel`. It stays visible as "Cancelled".
- [ ] **Step 4: Build + lint + dev check** — `npm run build && npm run lint`; dev-test: manually set one entry's `status` to `pending` (via Admin or a temp button) → it appears in Review → Pass assigns `TF-0002` and it enters the hisab; Cancel a passed one → balance drops, row shows Cancelled.
- [ ] **Step 5: Commit** — `git commit -m "feat(stage1): approval home + review queue + cancel"`

---

### Task 10: Full verification + deploy Stage 1

- [ ] **Step 1: Full money-logic suite** — `node test-freight.mjs` → `ALL FREIGHT CALC TESTS PASSED`.
- [ ] **Step 2: Build + lint** — `npm run build && npm run lint` (only the pre-existing react-refresh cosmetic errors allowed).
- [ ] **Step 3: Back-compat check** — confirm an entry saved before this change (no `status`) still counts in the hisab (normalizer defaults `status:'passed'`). Verify on the live data via a dev load against `unico-operations`.
- [ ] **Step 4: Deploy (iPhone hotspot)** — `npm run deploy`; verify live asset hash matches `dist/` and the app loads on a real iPhone (no blank screen — the Plastic lesson).
- [ ] **Step 5: Commit any deploy-config tweaks; update memory** — mark Stage 1 LIVE in `transport-freight-hisab.md`.

---

## Self-Review

- **Spec coverage (Stage 1 scope):** status+passed-only balance (T1) ✓; transitions incl. mandatory reasons (T2) ✓; atomic numbers via transaction (T3) ✓; optimistic concurrency via revision (T4) ✓; duplicate warning (T5) ✓; reversing-entry payment reversal + payment number (T6) ✓; audit before→after (T7) ✓; master-name snapshot (T8, T6 fields) ✓; approval home + review queue + Cancel-not-delete (T9) ✓; back-compat + deploy (T10) ✓. Gaadiwala login, scoped queries, and the rules rewrite are **Stage 2/3** (own plans) — deliberately excluded.
- **Placeholder scan:** logic tasks contain full function + test code; UI tasks (T8, T9) are precise behavioural specs against existing pages, matching this repo's Phase-1 plan convention (no React test runner). No "TBD".
- **Type consistency:** `STATUS`, `countsInHisab`, `applyTransition(entry, action, ctx)`, `nextFromCounters`, `allocateNumber(kind)`, `isStale`, `updateGuarded`, `findDuplicate`, `makeReversal`, `auditLine` are used with the same signatures across T1–T9. `status` values (`pending|needs_correction|passed|voided|cancelled`) are consistent. Watch the `status.js ↔ calc.js` import direction (noted in T5 Step 3) to avoid a cycle.
