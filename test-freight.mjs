/**
 * Pure money-logic tests for the freight calc layer (no React/Firebase).
 * Run: node test-freight.mjs
 */
import assert from 'node:assert'
import { entryTotal, transporterTotals, thresholdLevel, crossingAlert, lockedOn, unsettledFrom, ledgerLines, nextChallanNo } from './src/modules/freight/logic/calc.js'

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

console.log('ALL FREIGHT CALC TESTS PASSED')
