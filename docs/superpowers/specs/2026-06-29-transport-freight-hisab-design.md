# Transport Freight Hisab — Design Spec

**Date:** 2026-06-29
**Owner:** Nishant Mittal (UNICO / NSP)
**Status:** Approved in brainstorming — pending written-spec review

## Problem

A transport gaadiwala (vehicle contractor) takes UNICO's goods daily to many
transport booking offices in part-load (LTL). He WhatsApps the charges per drop:
freight, LR charge, unloading charge, misc. When one vehicle drops at 2–3
transports, he adds an **extra-point** charge: ~₹50 if the extra transport is in
the same area, ~₹200 if far. Advances are paid by Nishant or Anshul. The *hisab*
(running account) with each gaadiwala stays open until cleared, and tends to grow
too large before anyone settles it.

There are 2–3 (or more) gaadiwalas, each with his own running balance.

## Goal

A simple, mobile-first app to record daily freight, track advances, show each
gaadiwala's live pending balance, alert before the balance grows too big, and
settle + lock + PDF — modelled on the existing **welder** app (contractor work +
advances + running hisab + finalize/lock), which solves a structurally identical
problem.

## Approach

Clone the welder app's structure and retarget it to freight. New app, own repo,
gh-pages deploy, on the shared `unico-operations` Firebase — same stack as every
other UNICO app (Vite + React + Firebase + `src/core`). Reuse `src/core`
(repository CRUD with the `normalize` hook, storage adapter, UI components,
PasswordGate/AuthGate). **Clone-and-adapt**, so watch for copy-paste leftovers
(the Plastic blank-screen lesson) — verify a real Vite build and a real device
load after building.

## Data model (4 collections in `unico-operations`)

Proposed collection names (final names confirmed at build):
`transporters`, `freightDestinations`, `freightEntries`, `freightAdvances`,
`freightSettlements`.

### transporters (gaadiwalas)
- `name`, `phone`, `active`
- `runningBalance` — maintained incrementally (see Balance, below)
- standard: `id`, `createdAt`, `updatedAt`, `deleted` (soft-delete)

### freightDestinations (transport booking offices)
- `name`, `active`
- Used for the dropdown so the transport name is never re-typed.
- **No area field** — owner chose to free-type the extra-point amount, so no
  same/far master is needed.

### freightEntries — ONE ROW PER TRANSPORT (key decision)
Each delivery to one transport is its own row:
- `date`, `transporterId` (gaadiwala), `gaadiNumber`, `bags`, `pvtMarka`,
  `destinationId` (transport, from dropdown)
- `freight`, `lrCharge`, `unloading`, `misc`, `extraPoint`
- `extraPoint` is free-typed; the field shows a hint "+50 same area / +200 far".
- **rowTotal = freight + lrCharge + unloading + misc + extraPoint**

**Multi-drop semantics (money correctness):** when one vehicle drops at 2–3
transports the same day, that is simply 2–3 separate rows sharing the same
`gaadiNumber` + `date`. **Each row keeps its own freight.** The extra-point ₹ is
added only on the 2nd/3rd rows. The app NEVER splits one vehicle freight across
drops — so the hisab never double-counts.

### freightAdvances
- `date`, `transporterId`, `amount`, `paidBy` ("Nishant" | "Anshul"), `note`

### freightSettlements (hisab clear / finalize)
- `transporterId`, `periodFrom`, `periodTo`, `totalFreight`, `totalAdvances`,
  `balance`, `lockedAt`, `pdfMeta`
- On settle: entries + advances in range are locked (no edits to history).

## Balance (quota-safe)

Firebase free tier already exhausts ~50k reads/day. The per-gaadiwala balance must
NOT be computed by re-reading the whole `freightEntries` collection on every app
open. Maintain a `runningBalance` per transporter, updated incrementally as
entries/advances are added/edited/settled (same lesson the laser app applied when
it stopped reading all jobs for reports). Full recompute only on an explicit
"recalculate" admin action.

**Balance = Σ rowTotal (unsettled) − Σ advances (unsettled).**

## Threshold alerts (₹5k / 10k / 15k / 20k)

- Per gaadiwala. Fires when his pending balance **crosses** a level.
- Escalating colour: yellow (₹5k) → orange (₹10k) → red (₹15k) → dark red (₹20k+).
- **In-app banner** (owner's choice) on the gaadiwala's screen.
- **Admin dashboard** lists all gaadiwalas' balances sorted high → low, with the
  colour, so Nishant/Anshul instantly see who to clear first.
- **Never blocks new entries** — alerting must not halt operations.
- Built as a small, isolated alert module so it can ALSO push to the live
  `wa_outbox` WhatsApp bridge in a later phase with no rework.

## Settle + lock + PDF

Anytime hisab is cleared for a gaadiwala: statement of total freight, less
advances, balance → shareable PDF (WhatsApp-friendly) → locked. Identical pattern
to the welder hisab/finalize flow.

## Roles & auth (phased)

- **Phase 1 (this build): staff entry only.** Nishant + Anshul (Google-login
  admin allowlist) enter every gaadiwala's trips from the WhatsApp messages —
  exactly like the welder app. Ships fast, zero security compromise.
- **Phase 2 (later): per-gaadiwala login** with data isolation (each sees only his
  own trips/hisab), once Phase 1 is proven on the floor. Requires each gaadiwala
  to have a real auth identity mapped to his transporter record.

## Safety rules (UNICO standard — explicit)

- Google-login admin allowlist; **anonymous auth stays blocked** (never re-enabled
  — it is load-bearing across all apps).
- Soft-delete (`deleted` flag) — nothing truly removed; history preserved.
- Audit trail (`createdAt`/`updatedAt`/`createdBy`).
- Additive schema via the `normalize` hook — new fields never break old rows.
- CSV + PDF exports.
- Offline-capable PWA, big buttons, Hindi-friendly labels, minimal typing,
  dropdowns over typing.
- Drive backup.
- **Firestore rules:** the new collections must be added to the single shared
  `unico-operations` ruleset and deployed via `attendance-app/jobs/deployRules.js`.
  A missing rule = silent default-deny read — verify reads after deploy.

## Out of scope (YAGNI for Phase 1)

- Per-gaadiwala login / data isolation (Phase 2).
- WhatsApp/Telegram push of alerts (module-ready, switched on later).
- Linking freight to specific UNICO orders/dispatch.
- Area master / auto extra-point calculation (owner free-types the amount).

## Success criteria

1. Staff can record a daily trip in under ~20 seconds with transport picked from a
   dropdown (no re-typing).
2. Each gaadiwala's live pending balance is correct and visible without heavy
   reads.
3. Crossing ₹5k/10k/15k/20k shows the escalating banner + admin sort.
4. Settle produces a correct locked PDF statement.
5. No existing app or shared rule is broken; build + real-device load verified.
