# Offline Outbox — save chakkars to the phone, upload when online

**Date:** 2026-07-10
**App:** transport-freight (LOCKED / feature-frozen — this is an owner-requested bug-fix)
**Trigger:** 2026-07-09 data-loss incident. Anshul (manager) entered chakkars in the
afternoon; none reached the cloud and none were on his phone. See memory
`transport-freight-hisab` incident note.

## Problem (root cause, verified in code)

The app has `persistentLocalCache` enabled, so its comment claims "offline-capable."
But the **new-chakkar save cannot run offline**, because it depends on two Firestore
**transactions** (`runTransaction`), which require a live server round-trip and are
NOT queued by the offline cache:

1. `allocateNumber('challan')` — grabs the next global-sequential challan number.
2. `entries.commitBatch({ inserts, balance })` — writes all drop rows + the balance
   delta as one all-or-nothing transaction.

When the connection drops or the free-tier quota is exhausted, both throw. The save's
`catch` shows a toast and **nothing is persisted anywhere** — not even locally. That is
why Anshul's chakkars vanished with no trace.

## Goal

A chakkar must be **durably saved on the phone the instant Save is tapped**, before any
network is needed, and then **uploaded automatically when the connection/quota returns**.
No silent loss, regardless of network OR quota.

Non-goal: multi-device visibility while offline (pending chakkars live on the entering
phone until they sync — the accepted trade-off vs Blaze). Not solving owner-edit,
advances, or settle offline (see Scope).

## Scope

**IN (Phase 1):**
- the **new-chakkar save** — the daily driver, and the exact path that lost data. Covers
  both staff/manager "passed" save (challan + balance) and gaadiwala "pending" submit
  (no challan, no balance).
- the **advance/payment save** (owner ask) — money paid to a gaadiwala. Same failure
  cause (`allocateNumber('payment')` transaction + non-idempotent balance), same fix.
- **owner alert** when something is saved-but-not-uploaded (owner ask) — see §6.

**OUT (stay online-only, with a clear "needs internet" message — unchanged behaviour):**
owner-edit of an existing chakkar, settle, Admin tools. Settle especially must be done
online with care. Adding a new transport/gaadiwala master offline is also out (rare; the
chakkar still records the typed name in remarks).

## Design

### 1. Local outbox store (durable, on-device)
New pure module `logic/outbox.js` over a storage adapter (localStorage, same pattern as
`lastUsedStore`). Each queued item is the raw chakkar the user typed:

```
{ id, batchId, entryIds[], kind: 'new'|'pending', by, level,
  transporterId, transporterName, gaadiNumber, date, drops[], grand, createdAt }
```

- `batchId` and `entryIds[]` are generated **once, client-side, at Save time** and reused
  on every upload attempt → replays overwrite the SAME docs (idempotent inserts), never
  duplicate rows.
- API: `enqueue(item)`, `list()`, `remove(id)`, `has(id)`.

### 2. Save flow (Entry.jsx, new-chakkar path)
1. Build the chakkar payload with pre-generated `batchId` + `entryIds`.
2. **`outbox.enqueue(item)` — durable on the phone first.** Clear the form; the user can
   enter the next chakkar immediately.
3. Attempt the online upload (see §3) right away.
   - success → `outbox.remove(id)`, show the challan number.
   - failure → leave it queued, show a **calm** message: *"Saved on your phone ✓ — will
     upload when online"* (replaces the current scary red "couldn't save" for this path).

### 3. Idempotent upload — `commitChakkarOnce`
New provider function, modelled on the existing idempotent `commitReversalAndBalance`:

```
runTransaction:
  read the guard doc = entry(entryIds[0])
  if it already exists  → return { ok:true, already:true }   // already uploaded; DO NOTHING
  else                  → insert all drop rows + apply balance increment (one txn)
```

The guard read makes the balance increment safe to retry: a lost-response retry (server
committed but client thought it failed) reads the existing first row and **skips** — so
the balance is never double-counted. This is the one real risk of an outbox (at-least-once
delivery + non-idempotent `increment`), and the guard closes it.

Challan number: `allocateNumber('challan')` is called just before `commitChakkarOnce` at
**upload** time (so offline chakkars have no number until they upload; numbers stay
sequential). A challan burned by a skipped retry is a harmless gap (same as settle today).

### 4. Auto-upload (sync)
`syncOutbox()` in the provider iterates `outbox.list()` and runs §3 for each. Triggered on:
- app load (after sign-in ready),
- the browser `online` event,
- a manual **"Upload now"** tap,
- (optional) a light interval while items remain.

Serial, best-effort; a still-failing item stays queued for the next trigger.

### 5. UI — "Pending upload" visibility
A small amber chip in the shell / Entry page: **"⬆️ Pending upload (N)"** → expands to the
queued items (chakkars: date, gaadiwala, drops, amount; advances: gaadiwala, amount) +
**"Upload now."** So the user always knows the data is safe and still waiting. Clears to
nothing when all uploaded.

### 5b. Advances outbox
Advance saves route through the same outbox. New idempotent `commitAdvanceOnce` (guard-read
the deterministic advance id in a transaction; skip if it exists → balance never
double-applied on replay). `allocateNumber('payment')` is called at upload time; a burned
number on a skipped retry is a harmless gap. The reversal path stays online-only + unchanged
(it is already idempotent via `rev_<paymentNo>`, but reversing is a rare owner action).

### 6. Owner alert (saved-but-not-uploaded)
Constraint: pending items live on the entering phone; the repo is PUBLIC so no bot token
may ship in the client bundle; and during a quota/network outage the server can't see the
phone-local queue. So:

- **Phase 1 (no secret, no infra):** when an item lands in the outbox because its immediate
  upload failed, and whenever items remain pending, show an **unmissable persistent banner**
  on that device with a one-tap **"Notify owner on WhatsApp"** button — a `wa.me/<owner>`
  deep link pre-filled with "<name> saved N chakkar(s)/payment(s) on the phone that haven't
  uploaded yet." Works on any internet, leaks nothing, needs no server. (Owner WhatsApp =
  +919810013908, from the catalog memory — confirm before wiring.)
- **Phase 2 (optional, flagged — not built now):** fully-automatic zero-tap alert via a
  small free relay (Cloudflare Worker holding the Telegram token); the phone POSTs the
  worker, the worker forwards to the owner's Telegram/WhatsApp. Survives Firestore quota
  outages (different service). Deferred unless the owner wants hands-free alerts.

## Impact on existing features
- New-chakkar save switches from `commitBatch` to idempotent `commitChakkarOnce`; advance
  save switches from `commitAdvanceAndBalance` to idempotent `commitAdvanceOnce`.
  **Money-path change — must be tested: balance applied exactly once online AND exactly once
  after an offline replay, for both chakkars and advances.**
- `commitBatchGuarded` stays as-is for owner-edit / Review pass/return/cancel (unchanged).
  `commitReversalAndBalance` unchanged (reversal stays online-only).
- No Firestore rules change (same collections, same writes; the rules already allow a
  manager/gaadiwala to create entries + a manager to write advances + update the balance).
- Deterministic ids mean a re-uploaded chakkar/advance overwrites its own docs — no dups.

## Testing
- Pure `outbox.js` unit tests: enqueue/list/remove/has; survives reload (persisted).
- `commitChakkarOnce` + `commitAdvanceOnce` idempotency: a second call with the same guard
  id does NOT re-insert or re-increment (fake tx handle asserts guard-skip), matching the
  existing reversal test pattern.
- `node test-freight.mjs` stays green (money math unchanged).
- Device test (the real gate): airplane-mode → Save chakkar AND an advance → both show
  "Saved on phone", Pending shows 2, owner-notify button appears → turn network on →
  both auto-upload, challan/payment numbers appear, Pending clears, each balance moved
  exactly once (cross-check Admin → Recalculate = no drift).

## Rollout
Code-first, tests green, `npm run build` + lint clean, `npm run deploy` → gh-pages (nudge
Pages build via API), verify new asset serves 200. Owner device-test is the final gate.
