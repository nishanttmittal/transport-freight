/**
 * GaadiwalaHisab — what a gaadiwala sees of his OWN account (current period):
 * his chakkars bucketed by status, the payments UNICO made him, and his balance
 * due. Data is filtered client-side to his transporterId (real DB isolation lands
 * in Stage 3 with the rules rewrite + scoped query).
 */
import { useState } from 'react'
import { Card, Button, useToast, Toast } from '../../../core/ui'
import { fmtNum, fmtDate } from '../../../core/utils/format'
import { useFreight } from '../FreightContext'
import { entryTotal, transporterTotals, unsettledFrom, openingBalance } from '../logic/calc'
import { STATUS } from '../logic/status'
import { fmtChallan, fmtPayment } from '../config'
import ChakkarBreakup from '../ChakkarBreakup'

function groupBatches(rows) {
  const map = new Map()
  for (const r of rows) { const k = r.batchId || r.id; if (!map.has(k)) map.set(k, []); map.get(k).push(r) }
  return [...map.values()].map(list => ({
    batchId: list[0].batchId || list[0].id, rows: list, date: list[0].date,
    challanNo: list[0].challanNo, gaadiNumber: list[0].gaadiNumber, status: list[0].status || STATUS.passed,
    reason: list[0].correctionReason || list[0].cancelReason || '',
    total: list.reduce((s, r) => s + entryTotal(r), 0),
  }))
}

function Chakkar({ b, destName, tone = 'text-slate-800', children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3" onClick={() => setOpen(o => !o)}>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold truncate ${tone}`}>{b.challanNo ? fmtChallan(b.challanNo) + ' · ' : ''}{fmtDate(b.date)}{b.gaadiNumber ? ' · ' + b.gaadiNumber : ''}</div>
          <div className="text-xs text-slate-400">{b.rows.length} drop{b.rows.length > 1 ? 's' : ''}{b.reason ? ` · ${b.reason}` : ''}</div>
        </div>
        <div className="text-sm font-bold font-mono text-slate-800">₹{fmtNum(b.total)}</div>
      </div>
      {open && <div className="mt-2"><ChakkarBreakup rows={b.rows} destName={destName} /></div>}
      {children && <div className="flex flex-wrap gap-2 mt-2">{children}</div>}
    </div>
  )
}

function Section({ title, count, amount, children }) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <span className="font-bold text-slate-700 text-sm">{title}{count ? ` (${count})` : ''}</span>
        {amount > 0 && <span className="text-sm font-bold font-mono text-slate-600">₹{fmtNum(amount)}</span>}
      </div>
      {children}
    </Card>
  )
}

const sum = (list) => list.reduce((s, b) => s + b.total, 0)

export default function GaadiwalaHisab({ transporterId, onEdit }) {
  const { entries, advances, settlements, destinations } = useFreight()
  const { msg, show } = useToast()
  const destName = (id) => destinations.list.find(d => d.id === id)?.name || ''

  const from = unsettledFrom(settlements.list, transporterId)
  const opening = openingBalance(settlements.list, transporterId)   // carried-forward remainder from last settle
  const inWindow = (d) => !from || (d || '') > from
  const mine = (entries.list || []).filter(e => e.transporterId === transporterId && !e.deleted && inWindow(e.date))
  const myPays = (advances.list || []).filter(a => a.transporterId === transporterId && !a.deleted && inWindow(a.date))
  const balance = transporterTotals(entries.list, advances.list, transporterId, { from, opening }).balance

  const byStatus = (s) => groupBatches(mine.filter(e => (e.status || STATUS.passed) === s)).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const needs = byStatus(STATUS.needs_correction)
  const pending = byStatus(STATUS.pending)
  const passed = byStatus(STATUS.passed)
  const cancelled = byStatus(STATUS.cancelled)

  const withdraw = async (b) => {
    if (!window.confirm('Remove this trip? (only allowed before approval)')) return
    // Remove ALL drops of the chakkar in ONE atomic batch (P2-5) — never leave
    // some drops of a trip removed and others not.
    // REVISION-GUARDED (fix 2026-07-19, review #4): if the owner PASSED this trip while this
    // screen still showed it pending, an unguarded soft-delete would erase rows that had already
    // entered the running balance — money owed left standing with no trip behind it. As guarded
    // updates, a concurrent pass bumps the revision and this aborts as stale instead.
    const updates = b.rows.map(r => ({ id: r.id, expectedRevision: r.revision, patch: { deleted: true } }))
    const res = await entries.commitBatch({ updates })
    show(res && res.ok === false ? 'Could not remove — it was just approved or changed. Refresh and check.' : 'Removed')
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <Toast msg={msg} />

      <Card className="p-5">
        <div className="text-xs text-slate-500 uppercase tracking-wide font-bold">Balance due to you</div>
        <div className="text-3xl font-bold text-slate-800 font-mono mt-1">₹{fmtNum(balance)}</div>
        {from && <p className="text-[11px] text-slate-400 mt-2">This period (since last settlement {fmtDate(from)}).</p>}
        <p className="text-[11px] text-slate-400 mt-1">Tap any chakkar to see its freight, bilti &amp; labour.</p>
      </Card>

      {needs.length > 0 && (
        <Section title="⚠️ Needs correction" count={needs.length} amount={sum(needs)}>
          <div className="divide-y divide-slate-100">
            {needs.map(b => (
              <Chakkar key={b.batchId} b={b} destName={destName} tone="text-amber-700">
                <Button size="sm" variant="primary" onClick={() => onEdit(b.rows)}>Fix &amp; resubmit</Button>
                <Button size="sm" variant="neutral" onClick={() => withdraw(b)}>Remove</Button>
              </Chakkar>
            ))}
          </div>
        </Section>
      )}

      <Section title="Waiting for approval" count={pending.length} amount={sum(pending)}>
        {pending.length === 0 ? <div className="p-5 text-center text-slate-400 text-sm">Nothing waiting.</div> : (
          <div className="divide-y divide-slate-100">
            {pending.map(b => (
              <Chakkar key={b.batchId} b={b} destName={destName}>
                <Button size="sm" variant="primary" onClick={() => onEdit(b.rows)}>Edit</Button>
                <Button size="sm" variant="neutral" onClick={() => withdraw(b)}>Remove</Button>
              </Chakkar>
            ))}
          </div>
        )}
      </Section>

      <Section title="Approved" count={passed.length} amount={sum(passed)}>
        {passed.length === 0 ? <div className="p-5 text-center text-slate-400 text-sm">None yet.</div> : (
          <div className="divide-y divide-slate-100">{passed.map(b => <Chakkar key={b.batchId} b={b} destName={destName} />)}</div>
        )}
      </Section>

      {myPays.length > 0 && (
        <Section title="Payments received" count={myPays.length}>
          <div className="divide-y divide-slate-100">
            {myPays.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(a => {
              const isRev = a.reversal || Number(a.amount) < 0
              return (
                <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-800 truncate">{isRev ? 'Reversal' : 'Payment'}{a.paidBy ? ' · ' + a.paidBy : ''}</div>
                    <div className="text-xs text-slate-400">{fmtPayment(a.paymentNo) ? fmtPayment(a.paymentNo) + ' · ' : ''}{fmtDate(a.date)}</div>
                  </div>
                  <div className={`text-sm font-bold font-mono ${isRev ? 'text-slate-400' : 'text-emerald-600'}`}>{isRev ? '−' : ''}₹{fmtNum(Math.abs(Number(a.amount) || 0))}</div>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {cancelled.length > 0 && (
        <Section title="Cancelled" count={cancelled.length}>
          <div className="divide-y divide-slate-100 opacity-60">{cancelled.map(b => <Chakkar key={b.batchId} b={b} destName={destName} tone="text-slate-500" />)}</div>
        </Section>
      )}
    </div>
  )
}
