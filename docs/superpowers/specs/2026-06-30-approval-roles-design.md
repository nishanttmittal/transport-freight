# Transport Freight Hisab — Approval Workflow + Roles & Permissions (Phase 2)

**Date:** 2026-06-30
**Status:** DESIGN — awaiting owner review before implementation plan.
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
 G enters chakkar ─────────────► PENDING ──(N/A: Pass)──► PASSED  (in hisab, counts in balance)
                                   │  ▲                      │
            (N/A: Void)            │  │ (N/A: Edit fields)   │ (N/A: Edit / Delete per rules)
                                   ▼  │                      ▼
                                 VOIDED (never in hisab)   DELETED (soft; balance reversed)

 N/A enters chakkar ───────────► PASSED directly (they are the authority; no approval step)
```

- **PENDING:** submitted by a gaadiwala, **not** counted in any balance, **no official
  challan number yet** (shows "Pending review").
- **PASSED:** approved → enters the hisab, gets the next **official challan number**
  (`TF-0001…`), counts toward the balance.
- **VOIDED:** a pending chakkar rejected at review — never enters the hisab. Optional void
  reason. Kept for record (soft).
- **DELETED:** an already-passed chakkar removed later (per permission rules) — soft-delete,
  balance reversed. Kept for audit.

Only **gaadiwala-entered** chakkars pass through PENDING. Staff/owner entries are born PASSED.

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
| Withdraw/Delete own **Pending** chakkar | ✅ own only | ✅ | ✅ |
| Delete a **Passed** chakkar | ❌ | ✅ **current period only** | ✅ anytime* |
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

For his **current open period** only: his **chakkars** (with status Pending / Passed /
Voided), the **payments** Nishant/Anshul recorded for him, and his **running balance due**.
Full transparency to cut "you didn't pay me" disputes. After Nishant settles, the settled
items drop off his view and a clean new period starts.

---

## 7. Numbering

- **Challan no** (`TF-0001…`): assigned when a chakkar is **Passed** (so voided/rejected
  trips don't consume numbers). One per chakkar, fixed once assigned, global sequential.
- **Payment no** (`PAY-0001…`): assigned when a payment is recorded. One per payment,
  fixed, global sequential.

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

- `entrySchema`: add `status` (`pending|passed|voided`, default `passed` so existing rows
  stay in the hisab), `submittedBy`, `approvedBy`, `approvedAt`, `voidReason`,
  `adjustsChallanNo` (for adjustment lines). `challanNo` stays (now set on Pass).
- `advanceSchema`: add `paymentNo` (sequential).
- `userSchema`: add `role` value `gaadiwala` and a `transporterId` link.
- Hisab/balance math counts only `status == 'passed'` and not deleted; pending/voided are
  excluded. Adjustments are normal passed entries flagged with `adjustsChallanNo`.
- Every pass/void/edit/delete/settle writes an audit line to `logs` (who, when, old→new).

---

## 10. Staged delivery (ship safely, never break the live app)

1. **Stage A — Approval queue (no gaadiwala login yet):** add `status`, a "Pending review"
   screen for N/A, Pass/Void/Edit, balance counts passed-only, payment numbers. Staff entry
   still direct. **Flat layout retained — no migration.** *(Usable immediately; low risk.)*
2. **Stage B — Gaadiwala login + own view:** `gaadiwala` role + `transporterId` link;
   gaadiwala entry (→pending) + his dashboard (chakkars+payments+balance, current period),
   loaded via the **scoped `where('transporterId','==',id)` query** from §8.1.
3. **Stage C — Lock it down in rules:** role-based Firestore rules (own-transporter-only
   reads, pending-only gaadiwala writes, owner-only settle) + the settled-edit adjustment
   route + audit. Deploy + audit + **run the isolation smoke-test** (gaadiwala token must be
   denied another transporter's data) before trusting it.

---

## 11. Out of scope (note for later)

- WhatsApp/in-app notifications on submit/approve (we have the bridge — easy add later).
- Gaadiwala entering his own payments (payments stay owner/manager-only).
- Multi-factory / multi-owner.

---

## 12. Open items for owner to confirm at review

1. Matrix in §5 — anything wrong?
2. §6 — show gaadiwala his balance+payments (recommended) — OK?
3. §7 — challan number assigned on **Pass**, not on submit — OK? (keeps the challan book clean)
4. §5 note — editing a **settled** chakkar becomes an **adjustment** in the new period — OK?
5. Should Anshul be able to **enter payments** (matrix says yes) — confirm.
