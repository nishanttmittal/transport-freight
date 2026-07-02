# Transport Freight — Approval Workflow Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) tracking. This repo has NO React test runner — pure logic is node-tested in `test-freight.mjs`; UI/auth is gated by `npm run build` + device check.

**Goal:** Give the gaadiwala his own Google login that shows only his data and lets him submit trips as PENDING (for Nishant/Anshul to approve), fix returned trips, and see his own hisab — without touching the live staff flow.

**Architecture:** Add a `gaadiwala` role (linked to one `transporterId`) resolved in `AuthGate`. Route that role to a new `GaadiwalaView` (his New-trip + My-hisab). Reuse the existing `Entry` in a `pendingMode` (submits status `pending`, no challan, transporter locked to him). His screens **filter the already-loaded lists client-side** by his `transporterId` + current unsettled period. **Real database isolation (scoped query + restrictive rules) is Stage 3** — they are interdependent and ship together.

**Tech Stack:** Vite + React + Firebase (Google auth already wired: `signInWithGoogle`). gh-pages deploy.

## Global Constraints

- Additive & back-compatible. Existing staff/owner flow unchanged. Old rows keep working.
- Stage 2 is **UI-scoped only**; a REAL gaadiwala must NOT be given a login until Stage 3 rules are live (security note in the spec §8.1). Owner may test Stage 2 with his own linked account.
- Gaadiwala submits **PENDING** (no challan, no balance effect); challan + balance happen on Pass (Stage 1).
- Gaadiwala can edit/withdraw only his OWN pending / needs_correction chakkars (matrix §5).
- Reuse `Entry`, `applyTransition`, `entryTotal`, `transporterTotals`, `ledgerLines`, `updateGuarded` — no duplication.
- Deploy `gh-pages -d dist --dotfiles --nojekyll`. Gate: `npm run build` (+ node tests still green).
- Spec: `docs/superpowers/specs/2026-06-30-approval-roles-design.md`.

---

### Task 1: `gaadiwala` role in schema + AuthGate

**Files:** Modify `src/modules/freight/schema.js` (userSchema), `src/app/AuthGate.jsx`.

- [ ] **Step 1:** `userSchema` — add `field({ name: 'transporterId', label: 'Gaadiwala link', default: '' })`.
- [ ] **Step 2:** `AuthGate.jsx` `resolveRole(email, users)` — before the manager fallback, add: `if (u.role === 'gaadiwala') return 'gaadiwala'`. Add `resolveTransporterId(email, users)` returning the user's `transporterId` (''). 
- [ ] **Step 3:** In `AuthGate` default export, compute `const tid = resolveTransporterId(email, users.list)` and pass it into the children callback: `children({ role, email, name, transporterId: tid, signOut })`.
- [ ] **Step 4:** Build — `npm run build` passes.
- [ ] **Step 5:** Commit — `git commit -m "feat(stage2): gaadiwala role + transporter link in auth"`

---

### Task 2: Admin — link a gaadiwala (role + transporter)

**Files:** Modify `src/modules/freight/pages/Admin.jsx` (Users).

- [ ] **Step 1:** Add `transporters` to `useFreight()` in `Users`. Role `Select` options become `Staff (manager)`, `Owner`, `Gaadiwala`. Form state gains `transporterId`.
- [ ] **Step 2:** When `form.role === 'gaadiwala'`, render a transporter `Select` (active transporters) below the role; require it on add. Save `transporterId` on the user doc: `users.insert({ email, name, role: form.role, transporterId: form.role === 'gaadiwala' ? form.transporterId : '', active: true })`.
- [ ] **Step 3:** In the user list row, show the linked gaadiwala name for gaadiwala users (`· Gaadiwala: <name>`).
- [ ] **Step 4:** Build + commit — `git commit -m "feat(stage2): admin can link a gaadiwala login to a transporter"`

---

### Task 3: `Entry` pending mode (gaadiwala submits for approval)

**Files:** Modify `src/modules/freight/pages/Entry.jsx`.

- [ ] **Step 1:** Add props `pendingMode = false`, `lockTransporterId = ''`, `lockTransporterName = ''`. When `lockTransporterId` is set: initialise `veh.transporterId` to it and **hide the Gaadiwala picker** (show the fixed name as read-only text).
- [ ] **Step 2:** Replace the challan badge: if `pendingMode`, show a neutral "Will be sent for approval" chip instead of `fmtChallan(challanNo)`.
- [ ] **Step 3:** In `save()`, branch on `pendingMode`:
  - pending: `status: 'pending'`, `challanNo: 0`, **do NOT** `await allocateNumber` and **do NOT** `applyBalance` (pending never counts); stamp `submittedBy: by`, `transporterId: lockTransporterId`, `transporterName: lockTransporterName`. Toast "Sent for approval ✓".
  - else: existing passed path (unchanged).
- [ ] **Step 4:** Build + commit — `git commit -m "feat(stage2): entry pending-mode for gaadiwala submissions"`

---

### Task 4: `Entry` edit mode (fix a returned / pending chakkar)

**Files:** Modify `src/modules/freight/pages/Entry.jsx`.

- [ ] **Step 1:** Add prop `editBatch = null` (an array of the chakkar's rows). When set, initialise `veh` from row[0] (date, transporterId, gaadiNumber) and `drops` from the rows' fields; header shows "Editing chakkar".
- [ ] **Step 2:** On save in edit mode: for each existing row use `entries.updateGuarded(row.id, row.revision, patch)` with the edited fields + `status: 'pending'` (resubmit) + `correctionReason: ''`; if the drop count changed, insert/soft-delete extra rows (keep it simple: support editing existing drops' values; adding/removing drops on edit is out-of-scope — note in UI). On `{ok:false}` toast "Refresh — changed by someone else". Call `onDone?.()` after.
- [ ] **Step 3:** Build + commit — `git commit -m "feat(stage2): entry edit-mode to fix returned chakkars"`

---

### Task 5: `GaadiwalaView` (his New-trip + My-hisab) + client-side filtering

**Files:** Create `src/app/GaadiwalaView.jsx`; create `src/modules/freight/pages/GaadiwalaHisab.jsx`.

- [ ] **Step 1: `GaadiwalaHisab.jsx`** — props `{ transporterId, by }`. From `useFreight()`, `const mine = entries.list.filter(e => e.transporterId === transporterId && !e.deleted)`; scope to current period via `unsettledFrom(settlements.list, transporterId)`. Render buckets:
  - **Needs correction** (status `needs_correction`) — show `correctionReason`, a **Fix & resubmit** button (opens Entry editBatch), and **Withdraw**.
  - **Pending** (status `pending`) — grouped by batch, with **Edit** + **Withdraw** (soft-delete his own).
  - **Approved** (status `passed`) — read-only, with challan no.
  - **Cancelled** (status `cancelled`) — read-only, dimmed, with reason.
  - **Payments** (advances where `transporterId === his`, current period) — date, PAY-no, amount.
  - **Balance due** = `transporterTotals(entries.list, advances.list, transporterId, { from }).balance`.
- [ ] **Step 2: `GaadiwalaView.jsx`** — a 2-tab shell (New Trip / My Hisab) + a bottom bar with his name + Sign out. "New Trip" renders `<Entry pendingMode lockTransporterId={transporterId} lockTransporterName={name} by={name} />`. "My Hisab" renders `<GaadiwalaHisab transporterId by={name} />`. Editing a chakkar opens `<Entry editBatch={batch.rows} .../>` over the tab.
- [ ] **Step 3:** Build + commit — `git commit -m "feat(stage2): gaadiwala view (submit + own hisab), client-filtered"`

---

### Task 6: Route the gaadiwala role in AppShell

**Files:** Modify `src/app/AppShell.jsx`.

- [ ] **Step 1:** Import `GaadiwalaView`. In the cloud `AuthGate` children, before the staff/console branch: `role === 'gaadiwala' ? <GaadiwalaView transporterId={transporterId} name={name || email} onSwitch={signOut} /> : …`. (Pull `transporterId` from the callback args.)
- [ ] **Step 2:** Build + lint + commit — `git commit -m "feat(stage2): route gaadiwala login to GaadiwalaView"`

---

### Task 7: Verify + deploy

- [ ] **Step 1:** `node test-freight.mjs` green; `npm run build` + `npm run lint` (only pre-existing react-refresh cosmetics).
- [ ] **Step 2:** Dev check: in Admin add a gaadiwala user linked to a transporter (use a 2nd Google account or the owner's for testing); sign in as that account → GaadiwalaView; submit a trip → appears in staff **Approvals** as Pending; Pass it → shows Approved in his hisab with challan + balance; Return it → he sees Needs-correction + reason → Fix & resubmit.
- [ ] **Step 3:** Deploy (iPhone hotspot) `npm run deploy`; verify live asset hash + iPhone load.
- [ ] **Step 4:** Update memory; **flag that Stage 3 (rules + scoped query) must land before any real gaadiwala is given a login.**

## Self-Review

- **Spec coverage:** gaadiwala Google login + link (T1,T2) ✓; submit→pending, no challan/balance (T3) ✓; fix returned / edit / withdraw own pending (T4,T5) ✓; his dashboard buckets + payments + balance, current period (T5) ✓; routing (T6) ✓. Scoped query + rules = **Stage 3** (interdependent — deliberately deferred, noted).
- **Placeholder scan:** UI/auth tasks are precise behavioural specs against real files (this repo has no React test runner); logic reused from Stage 1. No TBD.
- **Type consistency:** `resolveRole`→'gaadiwala', `transporterId` threaded auth→AppShell→GaadiwalaView→Entry/GaadiwalaHisab; `pendingMode`/`lockTransporterId`/`editBatch` Entry props consistent across T3–T6; reuses `applyTransition`, `transporterTotals`, `unsettledFrom`, `updateGuarded` unchanged.
