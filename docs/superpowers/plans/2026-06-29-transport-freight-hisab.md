# Transport Freight Hisab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-first PWA to record daily transport freight per gaadiwala, track advances (paid by Nishant/Anshul), show each gaadiwala's live pending hisab with escalating ₹5k/10k/15k/20k banners, and settle + lock + PDF.

**Architecture:** Clone the welder app's shell + `src/core` (AppShell, AuthGate, module registry, repository/storage/firebase, field-schema, useCollection, UI). Replace the welder module with a lean `freight` module. Data lives under a NEW Firestore namespace `apps/transportfreight/*` in the shared `unico-operations` project — isolated from welder. Freight has NO piece-rates: every charge is typed on the entry. Hisab = Σ(entry totals, unsettled) − Σ(advances, unsettled), kept as an incremental running balance per transporter (quota-safe).

**Tech Stack:** Vite + React 18 + Tailwind + Firebase (Firestore + anonymous + Google auth) + jspdf/jspdf-autotable + vite-plugin-pwa. gh-pages deploy. No unit-test runner in the app — the gate is `npm run build` + `npm run lint`; pure money logic gets a plain-node test script (`test-freight.mjs`) like welder's `test-welder.mjs`.

## Global Constraints

- App namespace / SOURCE_APP = `transportfreight`; WORKFLOW_STAGE = `transport`; DEFAULT_FACTORY_ID = `main`.
- Firebase config: reuse `src/core/db/firebaseConfig.js` verbatim from welder (shared `unico-operations`). NOT secret.
- Bootstrap owner: `nspenterprises24@gmail.com` (OWNER_EMAILS), lowercase, mirrored in firestore.rules.
- Anonymous auth stays ENABLED for sync; Google sign-in gates the console. NEVER disable anon provider.
- Soft-delete only (`deleted` flag) — never hard-remove history. Additive schema via `makeNormalizer`.
- Deploy ALWAYS with `gh-pages -d dist --dotfiles --nojekyll`; keep `public/.nojekyll`.
- Phase 1 = staff (owner/manager) entry only. Per-gaadiwala login is Phase 2 — do NOT build it now.
- Extra-point ₹ is FREE-TYPED (hint "+50 same / +200 far") — no area master, no auto rule.
- One row per transport drop; each row carries its own freight; multi-drop rows share gaadiNumber+date.
- rowTotal = freight + lrCharge + unloading + misc + extraPoint.
- Thresholds (₹): LEVELS = [5000, 10000, 15000, 20000]; alert on CROSSING; never blocks entry.
- Money fields are integers/rupees (Number); guard every read with `Number(v) || 0`.

---

### Task 1: Scaffold the app from the welder skeleton

**Files:**
- Copy welder's build/config/shell/core into `~/transport-freight/`, EXCLUDING `node_modules`, `dist`, `.git`, and the entire `src/modules/welder/` folder.
- Create: `~/transport-freight/src/modules/freight/` (empty for now).
- Modify: `package.json` (name → `transport-freight`), `index.html` (title), `vite.config.js` (PWA name/base), `src/modules/registry.js`.

**Interfaces:**
- Produces: a buildable React app shell whose module registry imports `freightModule` from `./freight/manifest`.

- [ ] **Step 1: Copy the skeleton**

```bash
cd /home/nishel
rsync -a --exclude node_modules --exclude dist --exclude .git \
  --exclude 'src/modules/welder' --exclude 'docs/superpowers' \
  welder/ transport-freight/
mkdir -p transport-freight/src/modules/freight/{pages,logic}
```

- [ ] **Step 2: Point the registry at the freight module**

`src/modules/registry.js`:
```javascript
/** Module registry — the transport-freight app's single module. */
import { freightModule } from './freight/manifest'

export const modules = [freightModule]
export const getModule = (id) => modules.find(m => m.id === id) || modules[0]
```

- [ ] **Step 3: Rename the app**

- `package.json`: `"name": "transport-freight"`.
- `index.html`: `<title>Transport Freight Hisab</title>`.
- `vite.config.js`: in the PWA `manifest`, set `name: 'Transport Freight Hisab'`, `short_name: 'Freight'`. Keep `base` as-is (gh-pages path) but update to the new repo name later at deploy.

- [ ] **Step 4: Remove welder-only references in the shell**

`src/app/AuthGate.jsx`: change the two imports from `../modules/welder/WelderContext`/`config` to `../modules/freight/FreightContext`/`config`, and `useWelder` → `useFreight`. (FreightContext/config are created in Tasks 2/4.) Do the same swap anywhere else `grep -rl "modules/welder" src` reports.

- [ ] **Step 5: Build (will fail until Task 2-4 exist — that's expected)**

Run: `cd /home/nishel/transport-freight && npm install && npm run build`
Expected at this point: FAIL (freight module missing). Proceed to Task 2; Task 4 makes the build pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold transport-freight from welder skeleton"
```

---

### Task 2: Freight config + schema

**Files:**
- Create: `src/modules/freight/config.js`
- Create: `src/modules/freight/schema.js`

**Interfaces:**
- Produces: `KEYS` (collection names), `OWNER_EMAILS`, `SOURCE_APP`, `WORKFLOW_STAGE`, `DEFAULT_FACTORY_ID`, `ADMIN_PASSWORD`, `EDIT_WINDOW_HOURS`, `PAID_BY` (`['Nishant','Anshul']`), `THRESHOLD_LEVELS`, `EXTRA_POINT_HINT`; and schemas `transporterSchema`, `destinationSchema`, `entrySchema`, `advanceSchema`, `settlementSchema`, `userSchema`.

- [ ] **Step 1: Write `config.js`**

```javascript
/** Transport Freight Hisab — configuration & constants. */
export const APP_TITLE = 'Transport Freight Hisab'

export const SOURCE_APP = 'transportfreight'
export const WORKFLOW_STAGE = 'transport'
export const DEFAULT_FACTORY_ID = 'main'

/** Bootstrap owner(s) — always owner, mirror in firestore.rules. Lowercase. */
export const OWNER_EMAILS = ['nspenterprises24@gmail.com']
export const ROLES = { owner: 'owner', manager: 'manager' }
export const INCHARGE_LABEL = 'Staff'

/** Casual-delete speed-bump (page already owner-only via Google). Not security. */
export const ADMIN_PASSWORD = '6133923_N'

/** Correct an entry within this many hours; after that owner-only. */
export const EDIT_WINDOW_HOURS = 48

/** Who paid an advance. */
export const PAID_BY = ['Nishant', 'Anshul']

/** Hisab alert levels (₹). Banner escalates as balance crosses each. */
export const THRESHOLD_LEVELS = [5000, 10000, 15000, 20000]

/** Free-typed extra-point hint shown on the entry form. */
export const EXTRA_POINT_HINT = '+50 same area · +200 far area (per extra drop)'

export const QUICK_BAGS = [1, 2, 5, 10, 20, 50]

export const KEYS = {
  transporters: 'transporters',
  destinations: 'destinations',
  entries:      'entries',
  advances:     'advances',
  settlements:  'settlements',
  users:        'users',
  logs:         'logs',
  lastUsed:     'last_used',
}

/** Seed master lists for a fresh install (editable in Admin). */
export const DEFAULT_TRANSPORTERS = []
export const DEFAULT_DESTINATIONS = []
```

- [ ] **Step 2: Write `schema.js`**

```javascript
/**
 * Transport Freight Hisab — record schemas.
 *  • transporter = gaadiwala we pay (own running hisab)
 *  • destination = transport booking office (dropdown master, no re-typing)
 *  • entry       = ONE drop to ONE destination (its own freight + charges)
 *  • advance     = money paid to a gaadiwala (by Nishant/Anshul)
 *  • settlement  = a finalized, locked hisab period + snapshot
 */
import { field } from '../../core/schema/field'
import { todayStr } from '../../core/utils/format'

export const transporterSchema = [
  field({ name: 'name',          label: 'Transporter', type: 'text',   default: '', required: true }),
  field({ name: 'phone',         label: 'Phone',       type: 'text',   default: '' }),
  field({ name: 'active',        label: 'Active',      type: 'toggle', default: true }),
  // running balance (maintained incrementally; recompute available in Admin)
  field({ name: 'runningBalance', label: 'Balance',    type: 'number', default: 0, inList: false }),
  // highest threshold level already alerted (so a banner escalates, not repeats)
  field({ name: 'alertedLevel',  label: 'Alerted',     type: 'number', default: 0, inList: false }),
]

export const destinationSchema = [
  field({ name: 'name',   label: 'Transport (destination)', type: 'text',   default: '', required: true }),
  field({ name: 'active', label: 'Active',                  type: 'toggle', default: true }),
]

export const entrySchema = [
  field({ name: 'date',         label: 'Date',          type: 'date',   default: todayStr, required: true }),
  field({ name: 'transporterId', label: 'Transporter',  type: 'text',   default: '', required: true }),
  field({ name: 'gaadiNumber',  label: 'Gaadi No',      type: 'text',   default: '' }),
  field({ name: 'destinationId', label: 'Transport',    type: 'text',   default: '', required: true }),
  field({ name: 'bags',         label: 'Bags',          type: 'number', default: 0 }),
  field({ name: 'pvtMarka',     label: 'Pvt Marka',     type: 'text',   default: '' }),
  field({ name: 'freight',      label: 'Freight',       type: 'number', default: 0 }),
  field({ name: 'lrCharge',     label: 'LR Charge',     type: 'number', default: 0 }),
  field({ name: 'unloading',    label: 'Unloading',     type: 'number', default: 0 }),
  field({ name: 'misc',         label: 'Misc',          type: 'number', default: 0 }),
  field({ name: 'extraPoint',   label: 'Extra Point',   type: 'number', default: 0 }),
  field({ name: 'remarks',      label: 'Remarks',       type: 'text',   default: '' }),
  // backbone / audit (hidden)
  field({ name: 'batchId',        label: 'Batch ID',      default: '', inList: false }),
  field({ name: 'sourceApp',      label: 'Source App',    default: 'transportfreight', inList: false }),
  field({ name: 'workflowStage',  label: 'Workflow Stage', default: 'transport', inList: false }),
  field({ name: 'createdByRole',  label: 'Created By Role', default: '', inList: false }),
  field({ name: 'createdByUser',  label: 'Created By',    default: '', inList: false }),
  field({ name: 'updatedAt',      label: 'Updated At',    default: '', inList: false }),
  field({ name: 'factoryId',      label: 'Factory ID',    default: 'main', inList: false }),
]

export const advanceSchema = [
  field({ name: 'date',          label: 'Date',        type: 'date',   default: todayStr, required: true }),
  field({ name: 'transporterId', label: 'Transporter', type: 'text',   default: '', required: true }),
  field({ name: 'amount',        label: 'Amount',      type: 'number', default: 0 }),
  field({ name: 'paidBy',        label: 'Paid By',     type: 'text',   default: 'Nishant' }), // Nishant | Anshul
  field({ name: 'note',          label: 'Note',        type: 'text',   default: '' }),
  field({ name: 'reversed',      label: 'Reversed',    type: 'toggle', default: false }),
  field({ name: 'createdByUser', label: 'Created By',  default: '',     inList: false }),
  field({ name: 'updatedAt',     label: 'Updated At',  default: '',     inList: false }),
]

export const settlementSchema = [
  field({ name: 'transporterId', label: 'Transporter', type: 'text',   default: '', required: true }),
  field({ name: 'periodFrom',    label: 'From',        type: 'text',   default: '' }),
  field({ name: 'periodTo',      label: 'To',          type: 'text',   default: '' }),   // cutoff (lock on/before)
  field({ name: 'totalFreight',  label: 'Freight',     type: 'number', default: 0 }),
  field({ name: 'totalAdvances', label: 'Advances',    type: 'number', default: 0 }),
  field({ name: 'balance',       label: 'Balance',     type: 'number', default: 0 }),
  field({ name: 'finalizedBy',   label: 'By',          type: 'text',   default: '' }),
  field({ name: 'locked',        label: 'Locked',      type: 'toggle', default: true }),
]

/** App user for role-based access (Google sign-in). Doc id = lowercased email. */
export const userSchema = [
  field({ name: 'email',  label: 'Email',  type: 'text',   default: '', required: true }),
  field({ name: 'name',   label: 'Name',   type: 'text',   default: '' }),
  field({ name: 'role',   label: 'Role',   type: 'text',   default: 'manager' }), // owner | manager
  field({ name: 'active', label: 'Active', type: 'toggle', default: true }),
]
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: freight config + schema"
```

---

### Task 3: Pure money logic (`logic/calc.js`) + node test

The hisab core. Pure functions, no React/Firebase — node-testable.

**Files:**
- Create: `src/modules/freight/logic/calc.js`
- Create: `test-freight.mjs` (repo root)

**Interfaces:**
- Produces:
  - `entryTotal(entry) -> number`
  - `transporterTotals(entries, advances, transporterId, { upToDate }) -> { freight, advances, balance }`
  - `unsettledFrom(settlements, transporterId) -> string` (cutoff date; '' if none)
  - `thresholdLevel(balance, LEVELS) -> number` (highest crossed level, 0 if below first)
  - `crossingAlert(prevBalance, newBalance, LEVELS) -> number|null` (a newly-crossed level, else null)
  - `lockedOn(settlements, transporterId, date) -> settlement|null`

- [ ] **Step 1: Write the failing test (`test-freight.mjs`)**

```javascript
import assert from 'node:assert'
import { entryTotal, transporterTotals, thresholdLevel, crossingAlert, lockedOn } from './src/modules/freight/logic/calc.js'

const LEVELS = [5000, 10000, 15000, 20000]

// entryTotal sums all charges
assert.equal(entryTotal({ freight: 1000, lrCharge: 50, unloading: 100, misc: 20, extraPoint: 200 }), 1370)
assert.equal(entryTotal({ freight: 500 }), 500)

// transporterTotals: balance = freight - advances, only this transporter
const entries = [
  { transporterId: 't1', date: '2026-06-10', freight: 1000, lrCharge: 0, unloading: 0, misc: 0, extraPoint: 0 },
  { transporterId: 't1', date: '2026-06-11', freight: 2000, lrCharge: 0, unloading: 0, misc: 0, extraPoint: 50 },
  { transporterId: 't2', date: '2026-06-11', freight: 9999, lrCharge: 0, unloading: 0, misc: 0, extraPoint: 0 },
]
const advances = [
  { transporterId: 't1', date: '2026-06-12', amount: 500, reversed: false },
  { transporterId: 't1', date: '2026-06-12', amount: 200, reversed: true }, // ignored
]
const tt = transporterTotals(entries, advances, 't1', {})
assert.equal(tt.freight, 3050)
assert.equal(tt.advances, 500)
assert.equal(tt.balance, 2550)

// thresholdLevel: highest crossed
assert.equal(thresholdLevel(4999, LEVELS), 0)
assert.equal(thresholdLevel(5000, LEVELS), 5000)
assert.equal(thresholdLevel(12000, LEVELS), 10000)
assert.equal(thresholdLevel(25000, LEVELS), 20000)

// crossingAlert: returns newly crossed level when rising past it
assert.equal(crossingAlert(4000, 6000, LEVELS), 5000)
assert.equal(crossingAlert(6000, 7000, LEVELS), null) // same band
assert.equal(crossingAlert(9000, 16000, LEVELS), 15000) // highest newly crossed
assert.equal(crossingAlert(6000, 3000, LEVELS), null) // falling, no alert

// lockedOn: entries on/before a locked settlement cutoff are locked
const settles = [{ transporterId: 't1', periodTo: '2026-05-31', locked: true }]
assert.ok(lockedOn(settles, 't1', '2026-05-20'))
assert.equal(lockedOn(settles, 't1', '2026-06-05'), null)

console.log('ALL FREIGHT CALC TESTS PASSED')
```

- [ ] **Step 2: Run it — expect failure (module missing)**

Run: `cd /home/nishel/transport-freight && node test-freight.mjs`
Expected: FAIL (cannot find `calc.js`).

- [ ] **Step 3: Implement `logic/calc.js`**

```javascript
/**
 * Freight money math — pure & derived. No React/Firebase. Money in whole ₹.
 * Hisab for a transporter = Σ(entry totals) − Σ(advances), excluding reversed
 * advances. Settled periods lock entries dated on/before the settlement cutoff.
 */
const num = (v) => Number(v) || 0

/** All charges on one drop. */
export function entryTotal(e) {
  return num(e.freight) + num(e.lrCharge) + num(e.unloading) + num(e.misc) + num(e.extraPoint)
}

/** Cutoff date of the latest locked settlement for a transporter ('' if none). */
export function unsettledFrom(settlements, transporterId) {
  const locked = (settlements || [])
    .filter(s => s.transporterId === transporterId && s.locked !== false && s.periodTo)
    .map(s => s.periodTo)
    .sort()
  return locked.length ? locked[locked.length - 1] : ''
}

/**
 * Totals for a transporter. By default counts only UNSETTLED activity (after the
 * latest locked cutoff). Pass { from } to override, { upToDate } to cap.
 */
export function transporterTotals(entries, advances, transporterId, opts = {}) {
  const from = opts.from
  const to = opts.upToDate
  const inRange = (d) => (!from || (d || '') > from) && (!to || (d || '') <= to)
  let freight = 0, adv = 0
  for (const e of (entries || [])) {
    if (e.transporterId !== transporterId || e.deleted) continue
    if (!inRange(e.date)) continue
    freight += entryTotal(e)
  }
  for (const a of (advances || [])) {
    if (a.transporterId !== transporterId || a.reversed || a.deleted) continue
    if (!inRange(a.date)) continue
    adv += num(a.amount)
  }
  return { freight, advances: adv, balance: freight - adv }
}

/** Highest threshold level the balance has crossed (0 if below the first). */
export function thresholdLevel(balance, levels) {
  let hit = 0
  for (const lv of levels) if (num(balance) >= lv) hit = lv
  return hit
}

/** A newly-crossed level when balance rises from prev to next, else null. */
export function crossingAlert(prev, next, levels) {
  const before = thresholdLevel(prev, levels)
  const after = thresholdLevel(next, levels)
  return after > before ? after : null
}

/** The locked settlement covering this date for a transporter, or null. */
export function lockedOn(settlements, transporterId, date) {
  if (!settlements || !date) return null
  return (settlements).find(s =>
    s.transporterId === transporterId && s.locked !== false && (s.periodTo || '') >= date) || null
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `node test-freight.mjs`
Expected: `ALL FREIGHT CALC TESTS PASSED`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: freight calc logic + node tests"
```

---

### Task 4: Data repos + Context + FirestoreProvider

**Files:**
- Create: `src/modules/freight/data.js`
- Create: `src/modules/freight/FreightContext.jsx`
- Create: `src/modules/freight/FirestoreProvider.jsx` (adapt welder's)

**Interfaces:**
- Consumes: repos from Task 2 schemas; `createCollection`/`createSingleton`/`makeId` from `core/db/repository`; `useCollection` from `core/hooks/useCollection`.
- Produces: `useFreight()` exposing `{ transporters, destinations, entries, advances, settlements, users, logs, lastUsed, log, cloud }`. Each collection is a `useCollection` handle (`.list`, `.insert`, `.update`, `.remove`).

- [ ] **Step 1: `data.js`**

```javascript
/** Transport Freight — data access. Masters seed empty; entries accumulate. */
import { createCollection, createSingleton } from '../../core/db/repository'
import { makeNormalizer } from '../../core/schema/field'
import { transporterSchema, destinationSchema, entrySchema, advanceSchema, settlementSchema, userSchema } from './schema'
import { KEYS } from './config'

export const transportersRepo = createCollection(KEYS.transporters, { seed: () => [], normalize: makeNormalizer(transporterSchema) })
export const destinationsRepo = createCollection(KEYS.destinations, { seed: () => [], normalize: makeNormalizer(destinationSchema) })
export const entriesRepo      = createCollection(KEYS.entries,      { seed: () => [], normalize: makeNormalizer(entrySchema) })
export const advancesRepo     = createCollection(KEYS.advances,     { seed: () => [], normalize: makeNormalizer(advanceSchema) })
export const settlementsRepo  = createCollection(KEYS.settlements,  { seed: () => [], normalize: makeNormalizer(settlementSchema) })
export const usersRepo        = createCollection(KEYS.users,        { seed: () => [], normalize: makeNormalizer(userSchema) })
export const logsRepo         = createCollection(KEYS.logs,         { seed: () => [] })
export const lastUsedStore    = createSingleton(KEYS.lastUsed, {})
```

- [ ] **Step 2: `FreightContext.jsx`** — mirror WelderContext, swapping repos. Local + Firestore providers; `WelderProvider`→`FreightProvider`, `useWelder`→`useFreight`, collections: transporters, destinations, entries, advances, settlements, users, logs; singleton lastUsed.

```javascript
import { createContext, useContext, useCallback } from 'react'
import { useCollection } from '../../core/hooks/useCollection'
import { transportersRepo, destinationsRepo, entriesRepo, advancesRepo, settlementsRepo, usersRepo, logsRepo, lastUsedStore } from './data'
import { isFirebaseConfigured } from '../../core/db/firebaseConfig'
import { FirestoreProvider } from './FirestoreProvider'

const Ctx = createContext(null)
export { Ctx as FreightCtx }

export function FreightProvider({ children }) {
  return isFirebaseConfigured ? <FirestoreProvider>{children}</FirestoreProvider> : <LocalFreightProvider>{children}</LocalFreightProvider>
}

export function LocalFreightProvider({ children }) {
  const transporters = useCollection(transportersRepo)
  const destinations = useCollection(destinationsRepo)
  const entries      = useCollection(entriesRepo)
  const advances     = useCollection(advancesRepo)
  const settlements  = useCollection(settlementsRepo)
  const users        = useCollection(usersRepo)
  const logs         = useCollection(logsRepo)
  const log = useCallback((action, detail, by = 'user', ref = '') => {
    logs.insert({ ts: new Date().toISOString(), action, detail, by, ref })
  }, [logs])
  const value = { transporters, destinations, entries, advances, settlements, users, logs, lastUsed: lastUsedStore, log, cloud: { connected: false, error: '' } }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFreight() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useFreight must be used inside <FreightProvider>')
  return v
}
```

- [ ] **Step 3: `FirestoreProvider.jsx`** — copy welder's `FirestoreProvider.jsx`; replace the welder collection list with `[transportersRepo, destinationsRepo, entriesRepo, advancesRepo, settlementsRepo, usersRepo, logsRepo]` + `lastUsedStore`; keep the anon-auth + `apps/<SOURCE_APP>` path wiring; set the namespace to `SOURCE_APP` from config (`transportfreight`). Match the exported context shape used by `FreightContext`.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS (app compiles even though manifest/pages come next — registry import of `./freight/manifest` will fail; create a stub manifest exporting `{ id:'freight', title, Provider:FreightProvider, pages:[] }` to make the build pass, then flesh it out in Task 11).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: freight data repos + context + firestore provider"
```

---

### Task 5: Entry page (record a drop)

**Files:**
- Create: `src/modules/freight/pages/Entry.jsx`

**Interfaces:**
- Consumes: `useFreight()`, `entryTotal`, `lockedOn` (calc), `transportersRepo`/`destinationsRepo` lists, `EXTRA_POINT_HINT`, `QUICK_BAGS`, core UI (`Button`, `Card`, inputs, `Toast`).
- Produces: writes one `entries` record via `entries.insert(...)` and bumps the transporter `runningBalance` (see Task 8 helper `applyBalance`).

- [ ] **Step 1: Build the form** — fields in order: Date (default today), Transporter (dropdown of active transporters; "＋ add" inline), Gaadi No (text, remembers last via `lastUsed`), Transport/destination (searchable dropdown of active destinations; "＋ add" inline — this is the no-re-typing master), Bags (number stepper w/ QUICK_BAGS chips), Pvt Marka (text), Freight (₹), LR Charge (₹), Unloading (₹), Misc (₹), Extra Point (₹ with helper text `EXTRA_POINT_HINT`), Remarks. Show a live **Total = entryTotal(form)** big at the bottom.
- [ ] **Step 2: Multi-drop helper** — after a successful save, keep Date + Transporter + Gaadi No, clear destination/bags/marka/charges, and show "Add another drop for this gaadi" so 2–3 transports on one vehicle are fast (each its own freight; user types extra-point on the 2nd/3rd). Stamp the same `batchId` (makeId) across drops saved in one sitting.
- [ ] **Step 3: Guards** — block save if transporter or destination empty; if `lockedOn(settlements.list, transporterId, date)` is set, block with a toast ("This period is settled & locked"). Stamp `createdByUser`, `createdByRole`, `updatedAt`, `sourceApp`, `workflowStage`, `factoryId`.
- [ ] **Step 4: On save, update running balance** — call the shared `applyBalance(transporters, transporterId, +entryTotal(rec))` (Task 8). 
- [ ] **Step 5: Build + manual check** — `npm run build`; run `npm run dev`, add a transporter + destination, save a drop, confirm total and that the balance reflects on Dashboard.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: freight entry page"`

---

### Task 6: Hisab page (per-transporter balance + settle + lock)

**Files:**
- Create: `src/modules/freight/pages/Hisab.jsx`
- Create: `src/modules/freight/logic/pdf.js`

**Interfaces:**
- Consumes: `transporterTotals`, `unsettledFrom`, `entryTotal` (calc); `useFreight()`; jspdf via `pdf.js`.
- Produces: `settlements.insert(...)` (locked snapshot); `freightStatementPdf({ transporter, rows, totals, period })` from `pdf.js`.

- [ ] **Step 1: Selector + ledger** — pick a transporter → show, for the UNSETTLED window (`unsettledFrom`), a dated line list: each entry (date, destination, gaadi, bags, rowTotal) and each advance (date, −amount, paidBy), with a running balance column, then a summary card: Total Freight, Less Advances, **Balance Due**.
- [ ] **Step 2: Threshold chip** — show the current band via `thresholdLevel(balance, THRESHOLD_LEVELS)` with escalating colour (Task 11 helper `levelStyle`).
- [ ] **Step 3: Settle + lock** — a "Settle Hisab" button (owner/manager): captures `{ transporterId, periodFrom, periodTo: today, totalFreight, totalAdvances, balance, finalizedBy, locked:true }`, writes a settlement, resets the transporter `runningBalance` to 0 and `alertedLevel` to 0. Confirm dialog first. After settle, entries/advances on/before `periodTo` are locked.
- [ ] **Step 4: PDF** — `pdf.js` builds a one-page statement (header with UNICO logo, transporter name, period, the line table via jspdf-autotable, totals, balance) and triggers download / share — copy the structure of welder's `logic/pdf.js`, dropping piece-rate columns.
- [ ] **Step 5: Build + check** — `npm run build`; dev-test a settle produces a PDF and locks the period.
- [ ] **Step 6: Commit** — `git commit -m "feat: hisab page + settlement lock + pdf"`

---

### Task 7: Advances page

**Files:**
- Create: `src/modules/freight/pages/Advances.jsx`

**Interfaces:**
- Consumes: `useFreight()`, `PAID_BY`, `applyBalance`.
- Produces: `advances.insert/update` records; balance decremented by amount.

- [ ] **Step 1: Form** — Date, Transporter (dropdown), Amount (₹), Paid By (toggle Nishant/Anshul), Note. On save: insert advance, `applyBalance(..., −amount)`, stamp `createdByUser`.
- [ ] **Step 2: List + reverse** — recent advances with edit (within window) and a "Reverse" (owner) that sets `reversed:true` and adds the amount back to the balance (never hard-delete). Block edits if the advance date is in a locked period.
- [ ] **Step 3: Build + check + commit** — `npm run build`; `git commit -m "feat: advances page"`

---

### Task 8: Dashboard + shared balance helper + threshold banners

**Files:**
- Create: `src/modules/freight/pages/Dashboard.jsx`
- Create: `src/modules/freight/logic/balance.js`

**Interfaces:**
- Produces:
  - `applyBalance(transportersHandle, transporterId, delta) -> void` (reads current `runningBalance`, writes `+delta`, and updates `alertedLevel` after computing `crossingAlert`).
  - `recomputeBalance(state, transporterId) -> number` (full recompute from entries+advances; used by Admin "recalculate").
  - `levelStyle(level) -> { bg, text, label }` (escalating colour per level).

- [ ] **Step 1: `balance.js`** — implement `applyBalance` (incremental, quota-safe), `recomputeBalance` (calls `transporterTotals` over unsettled window), and `levelStyle` (0→neutral, 5000→yellow, 10000→orange, 15000→red, 20000→dark red). Keep `levelStyle` keyed by exact level value.
- [ ] **Step 2: Dashboard** — a card per transporter sorted by balance DESC: name, balance, coloured band (`levelStyle(thresholdLevel(balance, LEVELS))`), last-activity date, and a tap-through to that transporter's Hisab. Top strip: today's total freight, # active transporters, total outstanding. **Reads only `transporters` for the headline balances** (no full-entries scan) — entries are read only when a transporter is opened.
- [ ] **Step 3: Threshold banner** — at the top of Dashboard and the per-transporter Hisab, if any transporter's `thresholdLevel > 0`, show the escalating banner ("Ramesh ₹16,400 — clear soon", red). NEVER blocks entry. Built as `<ThresholdBanner/>` so a later phase can also push to `wa_outbox`.
- [ ] **Step 4: Build + check + commit** — `npm run build`; `git commit -m "feat: dashboard + running-balance helper + threshold banners"`

---

### Task 9: Masters (Transporters + Destinations) + Admin

**Files:**
- Create: `src/modules/freight/pages/Masters.jsx`
- Create: `src/modules/freight/pages/Admin.jsx`

**Interfaces:**
- Consumes: `useFreight()`, `ADMIN_PASSWORD`, core `PasswordGate`.
- Produces: CRUD on transporters/destinations/users; backup (export JSON), recalculate-balances action.

- [ ] **Step 1: Masters** — two simple lists: Transporters (name, phone, active, soft-delete) and Destinations (name, active, soft-delete). Big add buttons, inline edit. This is the dropdown source for Entry.
- [ ] **Step 2: Admin (owner)** — Users & Access (email/name/role/active, mirrors welder), JSON backup/export of all collections, and a "Recalculate balances" button calling `recomputeBalance` for every transporter (safety net if an incremental update was missed). Guard destructive actions with `PasswordGate`/`ADMIN_PASSWORD`.
- [ ] **Step 3: Build + check + commit** — `git commit -m "feat: masters + admin"`

---

### Task 10: Export page (CSV/PDF)

**Files:**
- Create: `src/modules/freight/pages/Export.jsx`

- [ ] **Step 1:** Daily/period CSV of entries (date, transporter, gaadi, destination, bags, pvtMarka, each charge, total) and a "today's freight" PDF for WhatsApp. Reuse `pdf.js` + a small CSV helper. Owner-only.
- [ ] **Step 2: Build + commit** — `git commit -m "feat: export csv/pdf"`

---

### Task 11: Manifest, branding, logo, PWA

**Files:**
- Create/replace: `src/modules/freight/manifest.jsx`
- Modify: `public/` icons, `vite.config.js` PWA, logo per `feedback-always-use-logo`.

**Interfaces:**
- Consumes: all pages above.
- Produces: `freightModule` consumed by `registry.js`.

- [ ] **Step 1: Manifest** — `freightModule = { id:'freight', title:'Transport Freight Hisab', icon:'🚚', Provider:FreightProvider, HomeStats, floorPageKey:'entry', pages:[...] }`. Pages & roles (Phase 1, no gaadiwala role):
  - Daily work (owner+manager): `entry` (Entry, floor:true), `hisab` (Hisab), `advances` (Advances), `dashboard` (Dashboard), `masters` (Masters).
  - Owner tools: `export` (Export), `admin` (Admin).
  `HomeStats` shows: today's entries count, # transporters, total outstanding ₹.
- [ ] **Step 2: Logo + PWA** — use the real UNICO logo (white-badge header + favicon + PWA icon) from `~/unico-website/app-logo/` per [[feedback-always-use-logo]]; set PWA `name`/`short_name`/`theme_color`; keep `public/.nojekyll`.
- [ ] **Step 3: Build + full dev walkthrough** — `npm run build && npm run lint`; `npm run dev` end-to-end: add transporter+destination → 2-drop gaadi entry → advance → dashboard banner at ₹5k → settle → PDF.
- [ ] **Step 4: Commit** — `git commit -m "feat: manifest, branding, logo, PWA wiring"`

---

### Task 12: Firestore rules — add namespace + deploy

**Files:**
- Modify: `firestore.rules` (the shared `unico-operations` ruleset)
- Use: `attendance-app/jobs/getRules.js`, `deployRules.js`, `auditAllRules.js`

**Interfaces:**
- Produces: live rules granting authed access to `apps/transportfreight/**` with owner/manager gating mirrored from welder; anon read/write for sync per existing pattern.

- [ ] **Step 1: Pull live rules** — `cd /home/nishel/attendance-app && node jobs/getRules.js` (auto-backs up to `jobs/rules_backup/`).
- [ ] **Step 2: Add a block** for `match /apps/transportfreight/{document=**}` mirroring the welder block's allow conditions (authed; owner email allowlist for sensitive ops). A MISSING rule = silent default-deny read — so add it explicitly.
- [ ] **Step 3: Deploy + audit** — `node jobs/deployRules.js` then `node jobs/auditAllRules.js`; verify the new namespace reads back.
- [ ] **Step 4: Commit** — `git commit -m "chore: firestore rules for transportfreight namespace"`

---

### Task 13: Deploy + device verify

- [ ] **Step 1:** Create the GitHub repo `transport-freight`, set `vite.config.js` `base: '/transport-freight/'`, commit.
- [ ] **Step 2:** On the **iPhone hotspot** (GitHub is blocked on factory network — see [[github-network-block]]): `npm run deploy` (`gh-pages -d dist --dotfiles --nojekyll`).
- [ ] **Step 3:** Open the live URL on a real iPhone via the WhatsApp-shareable link; verify load (not a stale/blank screen — the Plastic lesson), sign in with the bootstrap Google account, do one real entry, confirm cloud sync + banner.
- [ ] **Step 4:** Final commit/tag; update memory `transport-freight-hisab` to LIVE with the URL.

---

## Self-Review

- **Spec coverage:** transporters/destinations/entries/advances/settlements (Tasks 2,4–9) ✓; one-row-per-transport + own freight (Task 5, entrySchema) ✓; free-typed extra-point (schema + Entry hint) ✓; dropdown destination master (Masters + Entry) ✓; advances paid_by Nishant/Anshul (Task 7) ✓; running hisab + settle+lock+PDF (Task 6) ✓; ₹5k/10k/15k/20k escalating in-app banner + admin sort, non-blocking (Tasks 8,11) ✓; quota-safe running balance (Task 8 balance.js) ✓; safety rules — Google allowlist/anon-kept/soft-delete/additive/exports/PWA/rules-deploy (Tasks 1,9,10,12) ✓; Phase-1 staff-only, gaadiwala login deferred (Global Constraints, Task 11 roles) ✓.
- **Placeholder scan:** core logic (calc, balance, schema, config, data, context) is complete code; pages are specified by exact fields/behaviour to be implemented against the welder templates that exist in `~/welder`. No "TBD".
- **Type consistency:** `entryTotal`, `transporterTotals`, `thresholdLevel`, `crossingAlert`, `lockedOn`, `unsettledFrom`, `applyBalance`, `recomputeBalance`, `levelStyle` names are used consistently across Tasks 3–11. `useFreight`/`FreightProvider`/`SOURCE_APP='transportfreight'` consistent across Tasks 2–12.
