# Transport Freight — Approval Workflow Stage 3 (Security Lockdown) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. UI/provider gated by `npm run build`; rules verified by a live isolation smoke-test (a gaadiwala token must be denied another transporter's data). Node money tests must stay green.

**Goal:** Make gaadiwala isolation real at the database level: role-based Firestore rules on `apps/transportfreight/**` + switch the gaadiwala's data-loading to a scoped `where('transporterId','==',tid)` subscription, so a gaadiwala can only ever read his own trips/payments and can only write his own PENDING trips — proven by a smoke-test. Plus the settled-edit adjustment route and the settlement snapshot/pdfHash.

**Architecture:** Add transportfreight-specific role helpers to the SHARED `unico-operations` ruleset (mirroring welder's pattern but reading `apps/transportfreight/users`). The client `FirestoreProvider` computes the current user's gaadiwala `transporterId` and, for a gaadiwala, subscribes to entries/advances/settlements **scoped** by that id (managers/owner keep whole-collection). Deploy CODE first, then rules (no real gaadiwala has a login yet, so interim is safe; staff/owner unaffected because rules still allow their whole-collection reads).

**Tech Stack:** Firebase Firestore rules (deployed via `attendance-app/jobs/deployRules.js`), Firestore modular SDK (`query`, `where`).

## Global Constraints

- **Pull live rules FIRST** (`node jobs/getRules.js`) so laser/plastic/welder/etc. are preserved; add only the transportfreight block; deploy; audit; **never** deploy `transport-freight/firestore.rules` (partial copy).
- Hard boundary = **own-transporter-only reads** + **gaadiwala writes only his own PENDING**. Period-scoping stays app-level (rules can't compare last-settlement date).
- Staff (manager) + owner keep full access and whole-collection reads. Bootstrap owner `nspenterprises24@gmail.com` can never be locked out. Settlement writes = owner only. `meta/counters` = manager/owner only.
- Masters (transporters/destinations) + users: any signed-in READ (needed for role resolution + dropdowns); write manager/owner. logs: create by any signed-in, read manager/owner.
- Additive/back-compatible; live app must keep working for staff/owner throughout.
- Deploy code `gh-pages -d dist --dotfiles --nojekyll`. Spec: `docs/superpowers/specs/2026-06-30-approval-roles-design.md` §8.

---

### Task 1: Scoped subscription for the gaadiwala (client)

**Files:** Modify `src/modules/freight/FirestoreProvider.jsx`.

- [ ] **Step 1:** Import `query, where` from `firebase/firestore` and `OWNER_EMAILS` from `./config`. Extend `useCloudCollection(collPath, docPath, normalize, authKey, scope)` — when `scope` (`{field,value}`) is set, subscribe to `query(collPath(), where(scope.field,'==',scope.value))`; deps `[authKey, scope?.value]`. Non-scoped path unchanged.
- [ ] **Step 2:** Track the signed-in email: in the `watchAuth` effect, also `setAuthEmail(u && !u.isAnonymous ? (u.email||'').toLowerCase() : '')`.
- [ ] **Step 3:** Declare `users` BEFORE entries/advances/settlements. Compute `const me = users.list.find(u => (u.email||'').toLowerCase() === authEmail); const gTid = (me && me.role === 'gaadiwala' && me.active !== false && !OWNER_EMAILS.map(x=>x.toLowerCase()).includes(authEmail)) ? (me.transporterId||'') : ''`.
- [ ] **Step 4:** Pass `scope = gTid ? { field:'transporterId', value: gTid } : null` to the `entries`, `advances`, `settlements` `useCloudCollection` calls. transporters/destinations/logs stay whole-collection.
- [ ] **Step 5:** Build — `npm run build` passes. Commit — `git commit -m "feat(stage3): gaadiwala loads own data via scoped query"`

---

### Task 2: Settled-edit → adjustment + settlement snapshot/pdfHash

**Files:** Modify `src/modules/freight/pages/Hisab.jsx`, `src/modules/freight/logic/pdf.js` (hash), `schema.js` (already has snapshot fields from Stage 1 §9).

- [ ] **Step 1:** In `Hisab.jsx` `doSettle`, allocate a settlement number (`await allocateNumber('settlement')`) and store the snapshot: `settlementNo`, `settledAt: new Date().toISOString()`, `settledBy: by`, `transporterName`, `tripCount` (count of passed ledger freight lines), `totalPayments` (Σ advances in window), `closingBalance: totals.balance`, and `pdfHash` (see Step 2). Make `doSettle` async.
- [ ] **Step 2:** `pdf.js` — export `async function statementHash(args)` that builds the same doc and returns `sha256` of `doc.output('arraybuffer')` via `crypto.subtle.digest('SHA-256', …)` → hex. Call it in `doSettle` before writing the settlement; store as `pdfHash`. (If `crypto.subtle` unavailable, store '').
- [ ] **Step 3:** Add settlement schema fields if missing: `settlementNo`,`settledAt`,`settledBy`,`transporterName`,`tripCount`,`totalPayments`,`closingBalance`,`pdfHash`,`factoryId` (all default 0/'').
- [ ] **Step 4:** Build + commit — `git commit -m "feat(stage3): settlement snapshot + pdf hash + number"`

> Note: the "edit a SETTLED chakkar → adjustment in current period" owner flow is deferred to a small follow-up (owner rarely edits closed periods; settlement lock already prevents accidental change via `lockedOn`). Tracked in memory, not blocking Stage 3's security goal.

---

### Task 3: Role-based Firestore rules (the security core)

**Files:** Modify `~/attendance-app/firestore.rules` (the canonical shared ruleset). Use `attendance-app/jobs/{getRules,deployRules,auditAllRules}.js`.

- [ ] **Step 1: Pull live** — `cd ~/attendance-app && node jobs/getRules.js` (auto-backup). Confirm current apps present.
- [ ] **Step 2: Replace the transportfreight block** (currently the simple `if request.auth != null`) with role-based rules. Add helpers + matches BEFORE the catch-all:

```
    // ---- Transport Freight Hisab (role-based) --------------------------
    function tfPath() { return /databases/$(database)/documents/apps/transportfreight/users/$(tEmail()); }
    function tfExists() { return tEmail() != '' && exists(tfPath()); }
    function tfData() { return get(tfPath()).data; }
    function tfIsOwner() { return signedIn() && (bootstrapOwner() || (tfExists() && tfData().role == 'owner' && tfData().active == true)); }
    function tfIsManager() { return signedIn() && (tfIsOwner() || (tfExists() && tfData().role == 'manager' && tfData().active == true)); }
    function tfIsGaadiwala() { return signedIn() && tfExists() && tfData().role == 'gaadiwala' && tfData().active == true; }
    function tfMyTid() { return tfExists() ? tfData().transporterId : ''; }

    match /apps/transportfreight/users/{id}        { allow read: if signedIn(); allow write: if tfIsOwner(); }
    match /apps/transportfreight/transporters/{id} { allow read: if signedIn(); allow write: if tfIsManager(); }
    match /apps/transportfreight/destinations/{id} { allow read: if signedIn(); allow write: if tfIsManager(); }
    match /apps/transportfreight/meta/{id}         { allow read, write: if tfIsManager(); }
    match /apps/transportfreight/logs/{id}         { allow read: if tfIsManager(); allow create: if signedIn(); }
    match /apps/transportfreight/entries/{id} {
      allow read:   if tfIsManager() || (tfIsGaadiwala() && resource.data.transporterId == tfMyTid());
      allow create: if tfIsManager() || (tfIsGaadiwala() && request.resource.data.transporterId == tfMyTid() && request.resource.data.status == 'pending');
      allow update: if tfIsManager() || (tfIsGaadiwala() && resource.data.transporterId == tfMyTid() && request.resource.data.transporterId == tfMyTid() && resource.data.status in ['pending','needs_correction'] && request.resource.data.status in ['pending','needs_correction']);
      allow delete: if tfIsManager() || (tfIsGaadiwala() && resource.data.transporterId == tfMyTid() && resource.data.status in ['pending','needs_correction']);
    }
    match /apps/transportfreight/advances/{id} {
      allow read:  if tfIsManager() || (tfIsGaadiwala() && resource.data.transporterId == tfMyTid());
      allow write: if tfIsManager();
    }
    match /apps/transportfreight/settlements/{id} {
      allow read:  if tfIsManager() || (tfIsGaadiwala() && resource.data.transporterId == tfMyTid());
      allow write: if tfIsOwner();
    }
```
  Remove the old two `match /apps/transportfreight/...{ allow read, write: if request.auth != null }` lines.

- [ ] **Step 3: Deploy + audit** — `node jobs/deployRules.js` then `node jobs/auditAllRules.js`. Re-pull (`getRules.js`) and confirm all prior apps still present + transportfreight now role-based.
- [ ] **Step 4: Commit** the repo copy for record — in `~/transport-freight`, sync `firestore.rules`? NO (partial copy — leave a comment pointing to canonical). Instead `git commit` a note in the plan only. (attendance-app/jobs auto-backs up.)

---

### Task 4: Live isolation smoke-test (the proof)

**Files:** temp script in `~/transport-freight` (deleted after).

- [ ] **Step 1:** With the modular web SDK: sign in anonymously (baseline). Verify an anonymous/unlinked session **cannot** read `apps/transportfreight/entries` (permission-denied or empty). This confirms the open rule is gone.
- [ ] **Step 2:** (If a test gaadiwala Google account + linked transporter exists) assert: reading his own transporterId's entries works; a `where('transporterId','==','SOME_OTHER_TID')` query is **denied**; writing a `status:'passed'` entry is **denied**; writing his own `status:'pending'` entry is **allowed**. Without a test Google account, at minimum assert the anonymous/manager paths and document the gaadiwala assertions for the owner's device test.
- [ ] **Step 2b:** Confirm **manager/owner still read the whole collection** (bootstrap owner token) — no regression.
- [ ] **Step 3:** Clean up any test docs/counter writes (reset `meta/counters` if touched, like Stage 1).

---

### Task 5: Deploy + verify + memory

- [ ] **Step 1:** `node test-freight.mjs` green; `npm run build`.
- [ ] **Step 2:** Deploy code (iPhone hotspot) `npm run deploy`; verify live hash + owner still loads app (staff/owner path unaffected).
- [ ] **Step 3:** Push master. Update memory: Stage 3 LIVE; **gaadiwala logins are now safe to hand out**; note custom-claims as a future optimisation if rule `get()` cost grows.

## Self-Review

- **Spec coverage:** own-transporter-only reads (T3 entries/advances/settlements) ✓; gaadiwala writes only own PENDING (T3 entries create/update/delete) ✓; scoped subscription so his screen works under the rules (T1) ✓; settlement snapshot+pdfHash (T2) ✓; isolation smoke-test (T4) ✓; other apps preserved via pull-first (T3 Step 1) ✓. Settled-edit adjustment = small deferred follow-up (noted). Custom claims = future perf note.
- **Placeholder scan:** rules block is complete literal; provider change is precise; smoke-test steps concrete. No TBD.
- **Type consistency:** `tfIsManager/tfIsOwner/tfIsGaadiwala/tfMyTid` used consistently; provider `scope={field,value}` matches `useCloudCollection` new param; `allocateNumber('settlement')` matches Stage 1 counters.
