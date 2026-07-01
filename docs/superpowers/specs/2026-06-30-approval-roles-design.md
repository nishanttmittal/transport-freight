# Transport Freight Hisab — Approval Workflow + Roles & Permissions (Phase 2)

**Date:** 2026-06-30 (finalised 2026-07-01 after two external reviews, 9.8/10)
**Status:** APPROVED design — ready to turn into an implementation plan.
**Builds on:** the LIVE app (challan entries, multi-drop, hisab, settle+PDF). This is
additive; it must NOT break the current staff-entry flow or any saved data.

---

## 1. Goal (plain language)

Let the **gaadiwala** log in and enter his own **chakkars** (trips). Those entries do
**not** hit the real hisab until **Nishant or Anshul reviews** each one and **Passes** it
(or edits / voids it). Add proper **role-based access** so each person sees and can change
only what they should, enforced by the database — not just hidden buttons. Each **payment**
to a gaadiwala gets its own running number, like challans do.

---

## 2. Key concept: "the period"

A gaadiwala's **period** = everything since his **last settlement** (the existing
"unsettled window"). Settlement is **per-gaadiwala**. When Nishant settles a gaadiwala's
hisab, that period **locks** and a fresh period begins. Almost every visibility and
edit rule below is scoped to "the current (unsettled) period."

---

## 3. Roles

- **Gaadiwala (G)** — a vehicle contractor. Logs in (Google), linked to exactly one
  transporter record. Enters his own chakkars; sees only his own data.
- **Anshul / Staff (manager)** — reviews & approves; works within the current period.
- **Nishant (owner)** — full control, all gaadiwalas, all time.

Login = **Google sign-in** for everyone (decided 2026-06-30). Owner links each gaadiwala's
Google email to his transporter record in Admin → Users & Access (role = `gaadiwala`,
plus a `transporterId` link).

---

## 4. Chakkar lifecycle (state machine)

```
 G enters chakkar ─► PENDING ──(N/A: Pass)──────────► PASSED  (in hisab, counts in balance)
                       │  ▲                              │
       (N/A: Return)   │  │ (G edits & resubmits)        │ (N/A: Edit-in-place / Cancel per rules)
                       ▼  │                              ▼
              NEEDS_CORRECTION                          CANCELLED (kept in ledger; balance reversed)
                       │
       (N/A: Void) ────┴──────────────────► VOIDED (never in hisab)

 N/A enters chakkar ─────────────────────► PASSED directly (they are the authority; no approval)
```

- **PENDING:** submitted by a gaadiwala; **not** counted in any balance; **no official
  challan number yet** (shows "Pending review").
- **NEEDS_CORRECTION:** N/A returned it to the gaadiwala to fix (with a **mandatory reason** —
  wrong weight / vehicle / amount / challan). The gaadiwala edits and resubmits → PENDING.
  Better than voiding a fixable trip.
- **PASSED:** approved → enters the hisab, gets the next **official challan number**
  (`TF-0001…`, continuous), counts toward the balance.
- **VOIDED:** a pending chakkar rejected at review — never enters the hisab. **Mandatory
  void reason.** Kept for record (soft).
- **CANCELLED:** an already-passed chakkar removed later (per permission rules) — a
  **status change, not a delete**. It stays in the ledger marked "Cancelled", its balance
  contribution is reversed, with a mandatory reason. Nothing financial is ever hard-deleted.
  *(Pending/needs-correction chakkars, which never touched the hisab, can still be plain
  soft-deleted/withdrawn — they're not financial records.)*

Only **gaadiwala-entered** chakkars pass through PENDING/NEEDS_CORRECTION. Staff/owner
entries are born PASSED.

### 4.2 Concurrency (two people, one entry)

Every write carries the `revision` it was loaded at. On save, if the stored `revision` has
moved on (someone else edited first), the save is **rejected with "refresh — this was just
changed by X"** instead of silently overwriting. (Optimistic concurrency using `revision`.)

### 4.1 Correcting a PASSED entry (decided 2026-06-30)

- **Open (unsettled) period:** N/A **edit in place**. Every edit **increments a `revision`
  counter** and writes a full **before→after** line to the audit log, so no version is ever
  lost. (Chosen over ERP-style "adjustment for every change" to keep it simple for staff,
  while still preserving complete history.)
- **Settled (locked, paid) period:** the closed entry is **immutable**. A correction posts
  as a visible **adjustment** in the gaadiwala's current period (audit note references the
  original challan + old→new). Only the owner can do this.

---

## 5. Permissions matrix (final)

| Action | Gaadiwala | Anshul (manager) | Nishant (owner) |
|---|---|---|---|
| Enter chakkar | ✅ → Pending | ✅ → Passed | ✅ → Passed |
| **See** chakkars | own, **current period only** | **current period**, all gaadiwalas | **all, all time** |
| See payments + balance | own, current period | current period | all, all time |
| Edit a **Pending** chakkar | ✅ own only | ✅ | ✅ |
| Edit a **Passed** chakkar | ❌ | ✅ **current period only** | ✅ anytime* |
| Pass (approve) a Pending chakkar | ❌ | ✅ | ✅ |
| Void (reject) a Pending chakkar | ❌ | ✅ | ✅ |
| Withdraw own **Pending** chakkar (soft-delete) | ✅ own only | ✅ | ✅ |
| **Cancel** a **Passed** chakkar (status, reversible) | ❌ | ✅ **current period only** | ✅ anytime* |
| Record a payment | ❌ | ✅ | ✅ |
| Edit/reverse a payment | ❌ | current period | anytime* |
| Settle / clear hisab (lock period) | ❌ | ❌ | ✅ |

\* **Nishant editing/deleting an ALREADY-SETTLED (locked, paid) chakkar** does **not**
rewrite closed history. It posts a visible **adjustment** in the gaadiwala's **current
period** (with an audit note showing the original challan + old→new), so a hisab you've
already paid stays intact. Open-period entries he edits in place.

"Current period" = the gaadiwala's unsettled window. Once Nishant settles it, Anshul can no
longer touch those entries; only Nishant can (and only via the adjustment route above).

---

## 6. What the gaadiwala sees (his dashboard)

For his **current open period** only: his **chakkars** grouped into clear buckets —
**Pending · Needs correction · Approved · Rejected** — plus the **payments** Nishant/Anshul
recorded for him (**Paid**) and his **running balance due** (**Outstanding**). Full
transparency to cut "you didn't pay me" disputes. After Nishant settles, the settled items
drop off his view and a clean new period starts.

### 6.1 Approval home (Nishant / Anshul) — the operational homepage

The first screen for staff/owner is a live worklist: **Pending today · Returned today ·
Approved today · Voided today · Settlements pending · Total outstanding**. Tapping "Pending"
opens the review queue (Pass / Return / Void). This is where the day's work happens.

---

## 7. Numbering

- **Challan no** (`TF-0001…`): assigned when a chakkar is **Passed** (so voided/rejected
  trips don't consume numbers). One per chakkar, fixed once assigned, global sequential.
- **Payment no** (`PAY-0001…`): assigned when a payment is recorded.
- **Settlement no** (`SET-0001…`): assigned when a hisab is settled.

### 7.1 Allocation must be atomic (must-fix from review)

Numbers are **never** derived from "max seen on the client" (two simultaneous approvals could
collide). Each number is allocated inside a **Firestore transaction** on a counter document
`apps/transportfreight/meta/counters` (`{ challan, payment, settlement }`). A Firestore
transaction executes **atomically on the server even when started from the client** — so no
Cloud Function / separate backend is required, and concurrent approvals cannot produce a
duplicate number.

### 7.2 Numbering strategy & edge cases

- **Failed transaction:** the counter only advances when the transaction commits, so a failed
  Pass leaves **no gap**.
- **Cancelled/voided after the fact:** the number is **retained, never reused** (the trip stays
  in the ledger as Cancelled) — a small permanent gap is expected and correct for audit.
- **Seed / continue a paper book / import:** the counter doc's start value is settable
  (`CHALLAN_START` etc.); set it once before go-live to continue an existing series.
- Numbers are **display/reference** identifiers; the immutable record key stays the Firestore
  doc id. A gap in the visible series never affects balances.

---

## 8. Security — enforced in Firestore rules (the real work)

UI hiding is not enough; the rules must make the wrong action **impossible** even via the
raw API. The current "any signed-in can read/write" block for `apps/transportfreight/**`
is replaced by role-aware rules (mirroring the welder app's pattern), keyed off a
`apps/transportfreight/users/{email}` doc holding `role` (`gaadiwala|manager|owner`),
`active`, and (for gaadiwalas) `transporterId`:

- **Gaadiwala** can read only entries/advances where `transporterId == his linked id`
  **and** the chakkar is in his unsettled period; can create only PENDING entries for his
  own `transporterId`; can update/delete only his own **PENDING** entries; cannot write
  `status:'passed'`, `challanNo`, balances, payments, or settlements.
- **Manager** can read/write entries, advances, pass/void, within unsettled periods; cannot
  write settlements.
- **Owner** full access; bootstrap owner (`nspenterprises24@gmail.com`) can never be locked
  out. Settlement writes = owner only.
- **`meta/counters`** (number allocation): read/write by **manager/owner only** — a gaadiwala
  never allocates a number (his entries are PENDING and numberless until Passed).
- Anonymous stays for baseline sync only (no sensitive reads).

> Rules are deployed via `attendance-app/jobs/deployRules.js` after pulling live (so the
> other apps' rules are preserved), then audited — same safe procedure used on 2026-06-30.

### 8.1 Data layout & read isolation (DECIDED — critical)

Firestore rules **allow or deny a whole query; they do not filter it**. So a gaadiwala
**cannot** use the app's current "load all entries" subscription
(`onSnapshot(collection('…/entries'))`) — under any restrictive rule that listen is
rejected outright and **his own dashboard would show nothing**. This is the deciding
constraint, so the layout is fixed here:

- **Keep the flat layout** (`apps/transportfreight/entries`) — **no data migration** of the
  chakkars already saved.
- **Owner / Staff:** keep the existing whole-collection subscription (rule allows
  manager/owner).
- **Gaadiwala:** load with a **scoped query** — `where('transporterId','==', hisId)` (then
  narrowed in-app to his unsettled period). Rule:
  `allow read: if isManagerOrOwner() || resource.data.transporterId == myTid`. Firestore
  then **permits his scoped query and denies any unscoped or cross-gaadiwala query**
  (every returned doc must satisfy the rule, or the whole query is refused).
- `myTid` comes from his `users/{email}.transporterId` (a cached rule `get()`); if `get()`
  cost ever matters, upgrade to a **custom claim** on his auth token (set via
  `attendance-app/jobs` admin SDK when linking him).
- **Hard security boundary = "own-transporter-only."** This is a genuine breach if violated,
  so it is **verified with a rules smoke-test** — a gaadiwala token must FAIL to read another
  transporter's entry — before we trust it (same method used for the anon path on 2026-06-30).
- **Period-scoping and "pending-only edits" are APP-LEVEL integrity**, not hard rule
  guarantees (rules can't compare a query against "last settlement date"). Enforced in the
  app and best-effort in rules. Nobody should treat the period wall as a security guarantee —
  only the **transporter wall** is.

---

## 9. Data model changes (additive, back-compatible)

- `entrySchema`: add `status` (`pending|needs_correction|passed|voided|cancelled`, default
  `passed` so existing rows stay in the hisab), `revision` (int, +1 each edit — also drives
  concurrency check §4.2), `submittedBy`, `approvedBy`, `approvedAt`, `voidReason`,
  `correctionReason`, `cancelReason`, `adjustsChallanNo`. `challanNo` set on Pass (continuous).
  **Frozen master snapshot** (§6 review pt.6): `transporterName` at time of entry
  (`gaadiNumber` and `factoryId` are already stored as values), so renaming a gaadiwala later
  never changes old records/reports.
- `advanceSchema`: add `paymentNo` (continuous `PAY-0001`), `factoryId`, `transporterName`
  (snapshot). **Reversal = a new reversing payment** (negative, `reversesPaymentNo` links to
  the original); the original is **never edited** — matches the ledger principle.
- `settlementSchema`: add `settlementNo` (`SET-0001`), `settledAt`, `settledBy`,
  `transporterName` (snapshot), plus the totals **snapshot** — `tripCount`, `totalPayments`,
  `closingBalance` + `pdfHash` (SHA-256 of the generated statement, so the paid figure is
  provable later) + `factoryId`. Historical reports never drift if masters change later.
- `meta/counters` singleton (§7.1): `{ challan, payment, settlement }` — the atomic counters.
- `userSchema`: add `role` value `gaadiwala` and a `transporterId` link.
- Hisab/balance math counts only `status == 'passed'`; `pending / needs_correction / voided /
  cancelled` are excluded. Adjustments are normal passed entries flagged with `adjustsChallanNo`.
- **Duplicate guard (explicit criteria):** on entry, warn — **non-blocking** — if a chakkar
  already exists with the **same `transporterId` + `gaadiNumber` + `date` + same total** (and,
  if present, the same first `destinationId`). Shows "possible duplicate?", staff can proceed.
- **Audit:** every submit/return/pass/void/edit/cancel/settle/reverse writes a `logs` line —
  `action`, `user`, `role`, `timestamp`, `device` (userAgent), `reason` (where applicable),
  and `before`→`after`. (No IP — a client PWA can't capture it reliably without a server.)

---

## 10. Staged delivery (ship safely, never break the live app)

1. **Stage 1 — Approval queue + audit (no gaadiwala login yet):** `status`
   (+`needs_correction`, `cancelled`), the **approval home** (§6.1) + "Pending review" queue
   for N/A (Pass / Return / Void, mandatory reason), `revision` + **optimistic-concurrency**
   check + before→after audit log, **atomic** challan/payment/settlement numbers (§7.1),
   master-name snapshots, duplicate warning, Cancel (not delete), payment reversal = reversing
   entry, balance counts passed-only. Staff entry still direct. **Flat layout retained — no
   migration.** *(Usable immediately; lowest risk.)*
2. **Stage 2 — Gaadiwala login + own view:** `gaadiwala` role + `transporterId` link; Google
   login; gaadiwala entry (→pending) + his dashboard (buckets + payments + balance, current
   period), loaded via the **scoped `where('transporterId','==',id)` query** from §8.1.
3. **Stage 3 — Lock it down + settlement integrity:** role-based Firestore rules
   (own-transporter-only reads, pending-only gaadiwala writes, owner-only settle) + settled-
   edit **adjustment** route + settlement **snapshot/PDF-hash**. Deploy + audit + **run the
   isolation smoke-test** (a gaadiwala token must be denied another transporter's data)
   before trusting it.
4. **Stage 4 — Nice-to-haves (later, as needed):** reports/registers, notifications (via the
   WhatsApp bridge), offline (Firestore built-in persistence), photo attachments, search,
   duplicate-history, transporter-merge, an `accounts` role. None block launch.

---

## 11. Out of scope for now (Stage 4 or later — reviewed & deliberately deferred)

Deferred from the external review (real value, but not needed to launch; YAGNI):
- **Reports/registers** (transporter ledger, monthly freight, pending-approval, outstanding,
  settlement/payment registers, top transporters, avg freight). CSV export exists today.
- **Notifications** on submit/approve (we have the WhatsApp bridge — easy add later).
- **Offline entry** (switch on Firestore's built-in offline persistence when the driver app ships).
- **Photo attachments** (LR / weighbridge / invoice) — needs Firebase Storage.
- **Search** across vehicle/date/destination/status.
- **Transporter merge** (fold "Raj Transport" + "Raj Transport Delhi" into one).
- **`accounts` role** (record payments + reports, no approve/edit) — the role system is
  data-driven, so this is a trivial later add.

Not planned:
- Gaadiwala entering his own payments (payments stay owner/manager-only).
- Multi-owner. (Multi-**factory** is already future-proofed via `factoryId` on every record.)

---

## 11a. Business continuity / disaster recovery (guidance)

Not app logic, but part of running this as a real system:

- **Backups:** the data lives in the shared `unico-operations` Firestore. Turn on a
  **scheduled export** (daily) to Google Cloud Storage. *Honest note:* scheduled/PITR exports
  need the **Blaze** plan — tie this to the pending [[firestore-quota-blaze]] decision; until
  then, a periodic manual export script (from `attendance-app/jobs`, admin SDK) is the interim.
- **Audit log = append-only**, never edited/deleted; retain indefinitely (it's tiny).
- **PDF statements** are **regenerable** from the data, and each settlement stores a `pdfHash`,
  so a re-generated statement can be proven identical to the one paid against.
- **Recovery:** restore the Firestore export; app is stateless (GitHub Pages) and redeploys
  from git.

---

## 12. Decisions locked (owner, 2026-06-30 → 07-01)

- Gaadiwala login = **Google**. Edit settled = **adjustment in new period**. Anshul's window
  = **current period for both edit & delete** (no 7-day cap). Gaadiwala sees **chakkars +
  payments + balance**.
- Correcting a PASSED entry (open period) = **edit in place + `revision` + before→after audit**
  (not ERP adjustment-per-change). Numbers = **continuous** `TF-0001` / `PAY-0001`.
- Adopted from external review: `needs_correction` status (Return-to-driver), revision numbers,
  expanded audit (reason + before→after + device; no IP), settlement snapshot + PDF hash,
  duplicate warning, mandatory **void/return** reason, driver status buckets, 4-stage rollout.
- Pushed back (agreed): **approval reason optional** (only void/return mandatory); **no full
  open-period immutability**; Stage-4 features (photos, offline, notifications, search, reports,
  merge, `accounts` role) **deferred**, not built for launch.
- Confirmed: Anshul **can** record payments. `factoryId` already on records (extended to
  payments/settlements).
- 2nd external review (9.8/10) folded in: **Cancelled** status (no hard-delete of passed),
  **atomic** number allocation via Firestore transaction (the one must-fix — no backend
  needed), **optimistic concurrency** via `revision`, **reversing-entry** payment reversal,
  **frozen master-name snapshots** on records, richer **settlement metadata**, explicit
  **duplicate criteria**, **approval home** (§6.1), **numbering-strategy** edge cases (§7.2),
  and a **continuity/DR** section (§11a).
