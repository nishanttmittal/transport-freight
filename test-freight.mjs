/**
 * Pure money-logic tests for the freight calc layer (no React/Firebase).
 * Run: node test-freight.mjs
 */
import assert from 'node:assert'
import { entryTotal, transporterTotals, thresholdLevel, crossingAlert, lockedOn, unsettledFrom, ledgerLines, nextChallanNo } from './src/modules/freight/logic/calc.js'
import { countsInHisab, applyTransition, isStale, findDuplicate, makeReversal } from './src/modules/freight/logic/status.js'
import { nextFromCounters } from './src/modules/freight/logic/counters.js'
import { auditLine } from './src/modules/freight/logic/audit.js'
import { applyBalance } from './src/modules/freight/logic/balance.js'

const LEVELS = [5000, 10000, 15000, 20000]

// entryTotal sums all charges
assert.equal(entryTotal({ freight: 1000, lrCharge: 50, unloading: 100, misc: 20, extraPoint: 200 }), 1370)
assert.equal(entryTotal({ freight: 500 }), 500)

// transporterTotals: balance = freight - advances, only this transporter
const entries = [
  { id: 'e1', transporterId: 't1', date: '2026-06-10', freight: 1000, lrCharge: 0, unloading: 0, misc: 0, extraPoint: 0 },
  { id: 'e2', transporterId: 't1', date: '2026-06-11', freight: 2000, lrCharge: 0, unloading: 0, misc: 0, extraPoint: 50 },
  { id: 'e3', transporterId: 't2', date: '2026-06-11', freight: 9999, lrCharge: 0, unloading: 0, misc: 0, extraPoint: 0 },
  { id: 'e4', transporterId: 't1', date: '2026-06-11', freight: 500, deleted: true }, // ignored
]
const advances = [
  { id: 'a1', transporterId: 't1', date: '2026-06-12', amount: 500, reversed: false },
  { id: 'a2', transporterId: 't1', date: '2026-06-12', amount: 200, reversed: true }, // ignored
]
const tt = transporterTotals(entries, advances, 't1', {})
assert.equal(tt.freight, 3050)
assert.equal(tt.advances, 500)
assert.equal(tt.balance, 2550)

// unsettledFrom: only count activity after the latest locked cutoff
const settles = [{ transporterId: 't1', periodTo: '2026-06-10', locked: true }]
assert.equal(unsettledFrom(settles, 't1'), '2026-06-10')
const ttAfter = transporterTotals(entries, advances, 't1', { from: unsettledFrom(settles, 't1') })
assert.equal(ttAfter.freight, 2050) // only e2 (e1 is on the cutoff date, excluded)

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
const lk = [{ transporterId: 't1', periodTo: '2026-05-31', locked: true }]
assert.ok(lockedOn(lk, 't1', '2026-05-20'))
assert.equal(lockedOn(lk, 't1', '2026-06-05'), null)

// ledgerLines: dated, running balance, advance reduces balance
const lines = ledgerLines(entries, advances, 't1', {})
assert.equal(lines.length, 3) // e1, e2, a1 (e4 deleted, a2 reversed)
assert.equal(lines[lines.length - 1].balance, 2550)

// nextChallanNo: highest used + 1, respects start, ignores blanks
assert.equal(nextChallanNo([], 1), 1)                                   // none yet → start
assert.equal(nextChallanNo([], 1001), 1001)                            // custom start
assert.equal(nextChallanNo([{ challanNo: 4 }, { challanNo: 7 }, {}], 1), 8) // max+1, blank ignored
assert.equal(nextChallanNo([{ challanNo: 2 }], 1000), 1000)            // start wins when higher

// ---- Stage 1: status + passed-only hisab ----
assert.equal(countsInHisab({ status: 'passed' }), true)
assert.equal(countsInHisab({}), true)                       // legacy row, no status → counts
assert.equal(countsInHisab({ status: 'pending' }), false)
assert.equal(countsInHisab({ status: 'voided' }), false)
assert.equal(countsInHisab({ status: 'cancelled' }), false)
assert.equal(countsInHisab({ status: 'passed', deleted: true }), false)
const passEntries = [
  { transporterId: 't1', date: '2026-07-01', status: 'passed',    freight: 1000 },
  { transporterId: 't1', date: '2026-07-01', status: 'pending',   freight: 5000 },
  { transporterId: 't1', date: '2026-07-01', status: 'cancelled', freight: 9000 },
]
assert.equal(transporterTotals(passEntries, [], 't1', {}).freight, 1000) // only the passed one

// ---- Stage 1: state transitions ----
const passed2 = applyTransition({ status: 'pending', revision: 0 }, 'pass', { by: 'Anshul', role: 'manager', challanNo: 7 })
assert.equal(passed2.status, 'passed'); assert.equal(passed2.challanNo, 7); assert.equal(passed2.approvedBy, 'Anshul')
assert.throws(() => applyTransition({ status: 'pending' }, 'void', { by: 'Anshul' }), /reason/i)
const voided2 = applyTransition({ status: 'pending' }, 'void', { by: 'Anshul', reason: 'duplicate' })
assert.equal(voided2.status, 'voided'); assert.equal(voided2.voidReason, 'duplicate')
const ret2 = applyTransition({ status: 'pending' }, 'return', { by: 'Anshul', reason: 'wrong amount' })
assert.equal(ret2.status, 'needs_correction'); assert.equal(ret2.correctionReason, 'wrong amount')
assert.throws(() => applyTransition({ status: 'passed' }, 'cancel', { by: 'N' }), /reason/i)
const canc2 = applyTransition({ status: 'passed', challanNo: 7 }, 'cancel', { by: 'Nishant', reason: 'wrong trip' })
assert.equal(canc2.status, 'cancelled'); assert.equal(canc2.cancelReason, 'wrong trip'); assert.equal(canc2.challanNo, 7)
assert.throws(() => applyTransition({ status: 'cancelled' }, 'pass', {}), /illegal|cannot/i)

// ---- Stage 1: atomic counter allocation (pure part) ----
assert.equal(nextFromCounters({}, 'challan', 1), 1)               // fresh → start
assert.equal(nextFromCounters({ challan: 5 }, 'challan', 1), 6)   // last+1
assert.equal(nextFromCounters({ challan: 2 }, 'challan', 1000), 1000) // start wins when higher
assert.equal(nextFromCounters({ payment: 9 }, 'challan', 1), 1)   // kinds independent

// ---- Stage 1: optimistic-concurrency guard ----
assert.equal(isStale(3, 3), false) // same revision → fresh
assert.equal(isStale(2, 3), true)  // someone bumped it → stale
assert.equal(isStale(0, 0), false)

// ---- Stage 1: duplicate detection ----
const dupExisting = [{ id: 'a', transporterId: 't1', gaadiNumber: '1234', date: '2026-07-01', destinationId: 'd1', status: 'passed', freight: 2500 }]
const cand = { transporterId: 't1', gaadiNumber: '1234', date: '2026-07-01', destinationId: 'd1', freight: 2500 }
assert.ok(findDuplicate(dupExisting, cand))                                  // exact dup
assert.equal(findDuplicate(dupExisting, { ...cand, freight: 2600 }), null)  // different total
assert.equal(findDuplicate(dupExisting, { ...cand, gaadiNumber: '9999' }), null)
assert.equal(findDuplicate([{ ...dupExisting[0], status: 'voided' }], cand), null) // voided ignored

// ---- Stage 1: reversing-entry payment reversal ----
const pay = { id: 'p1', transporterId: 't1', date: '2026-07-01', amount: 500, paymentNo: 3 }
const rev = makeReversal(pay, 'Nishant')
assert.equal(rev.amount, -500); assert.equal(rev.reversesPaymentNo, 3); assert.equal(rev.transporterId, 't1')
assert.equal(transporterTotals([], [pay, rev], 't1', {}).advances, 0) // nets to zero

// ---- Stage 1: audit line ----
const al = auditLine('entry.pass', { by: 'Anshul', role: 'manager', reason: '', before: { freight: 100 }, after: { freight: 100, status: 'passed' }, device: 'test-ua' })
assert.equal(al.action, 'entry.pass'); assert.equal(al.by, 'Anshul'); assert.equal(al.device, 'test-ua')
assert.deepEqual(al.after, { freight: 100, status: 'passed' }); assert.ok(al.ts)

// ---- P1.2: applyBalance writes an ATOMIC delta (increment), not an absolute ----
// A fake transporters handle records how the write was made.
function fakeHandle(prev) {
  const calls = { inc: null, upd: null }
  return {
    list: [{ id: 't1', runningBalance: prev, alertedLevel: 0 }],
    incBalance: (id, delta, level) => { calls.inc = { id, delta, level } },
    update: (id, patch) => { calls.upd = { id, patch } },
    calls,
  }
}
// +2000 onto a 4000 balance → writes delta +2000 (NOT the absolute 6000) via incBalance
let h = fakeHandle(4000)
let crossed = applyBalance(h, 't1', 2000)
assert.equal(h.calls.inc.delta, 2000, 'writes the delta, not the absolute')
assert.equal(h.calls.upd, null, 'uses atomic incBalance, not absolute update')
assert.equal(h.calls.inc.level, 5000, 'alert hint reflects the new 6000 balance')
assert.equal(crossed, 5000, 'returns the freshly-crossed threshold for the toast')
// a payment (negative delta) reduces the balance atomically too
h = fakeHandle(6000)
applyBalance(h, 't1', -1500)
assert.equal(h.calls.inc.delta, -1500)
// falls back to absolute update only when no atomic method exists (offline/local)
const noInc = { list: [{ id: 't1', runningBalance: 1000 }], update: (id, patch) => { noInc.p = patch } }
applyBalance(noInc, 't1', 500)
assert.equal(noInc.p.runningBalance, 1500, 'fallback writes prev+delta')

console.log('ALL FREIGHT CALC TESTS PASSED')
