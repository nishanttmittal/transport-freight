// Firestore READ meter — diagnoses who's eating the shared 50k-reads/day quota. Non-invasive:
// wraps onSnapshot/getDocs, does the real read, tallies the doc count, and batches an increment into
// usage_reads/{YYYY-MM-DD}.totals[APP] (1 write per ~10s). onSnapshot bills per CHANGED doc (initial =
// all), so we count docChanges().length, not the full result size, to match real read cost.
import { onSnapshot as _onSnapshot, getDocs as _getDocs, doc, setDoc, serverTimestamp, increment } from 'firebase/firestore'
import { db } from './firebase'

const APP = 'transport'
const istDate = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
let pending = 0, timer = null
function flush() {
  if (timer) { clearTimeout(timer); timer = null }
  const n = pending; pending = 0
  if (!n || !db) return
  setDoc(doc(db, 'usage_reads', istDate()),
    { totals: { [APP]: increment(n) }, updatedAt: serverTimestamp() }, { merge: true }).catch(() => { pending += n })
}
function tally(n) { pending += n || 0; if (pending >= 100) return flush(); if (!timer) timer = setTimeout(flush, 10000) }
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })

export function getDocs(q) { return _getDocs(q).then((s) => { tally(s.size || 0); return s }) }
export function onSnapshot(ref, a, b, c) {
  const wrap = (fn) => (snap) => { try { tally(snap.docChanges ? snap.docChanges().length : (snap.size || 0)) } catch { /* noop */ } if (fn) fn(snap) }
  if (typeof a === 'function') return _onSnapshot(ref, wrap(a), b, c)
  if (a && typeof a === 'object' && (a.next || a.error)) return _onSnapshot(ref, { ...a, next: wrap(a.next) })
  if (typeof b === 'function') return _onSnapshot(ref, a, wrap(b), c)
  return _onSnapshot(ref, a, b, c)
}
