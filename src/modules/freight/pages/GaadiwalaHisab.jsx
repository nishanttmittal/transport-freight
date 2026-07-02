/**
 * GaadiwalaHisab — what a gaadiwala sees of his OWN account (current period):
 * his chakkars bucketed by status, the payments UNICO made him, and his balance
 * due. Data is filtered client-side to his transporterId (real DB isolation lands
 * in Stage 3 with the rules rewrite + scoped query).
 */
import { Card, Button, useToast, Toast } from '../../../core/ui'
import { fmtNum, fmtDate } from '../../../core/utils/format'
import { useFreight } from '../FreightContext'
import { entryTotal, transporterTotals, unsettledFrom } from '../logic/calc'
import { STATUS } from '../logic/status'
import { fmtChallan, fmtPayment } from '../config'

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

export default function GaadiwalaHisab({ transporterId, onEdit }) {
  const { entries, advances, settlements } = useFreight()
  const { msg, show } = useToast()

  const from = unsettledFrom(settlements.list, transporterId)
  const inWindow = (d) => !from || (d || '') > from
  const mine = (entries.list || []).filter(e => e.transporterId === transporterId && !e.deleted && inWindow(e.date))
  const myPays = (advances.list || []).filter(a => a.transporterId === transporterId && !a.deleted && inWindow(a.date))
  const balance = transporterTotals(entries.list, advances.list, transporterId, { from }).balance

  const byStatus = (s) => groupBatches(mine.filter(e => (e.status || STATUS.passed) === s)).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const needs = byStatus(STATUS.needs_correction)
  const pending = byStatus(STATUS.pending)
  const passed = byStatus(STATUS.passed)
  const cancelled = byStatus(STATUS.cancelled)

  const withdraw = (b) => {
    if (!window.confirm('Remove this trip? (only allowed before approval)')) return
    b.rows.forEach(r => entries.update(r.id, { deleted: true }))
    show('Removed')
  }

  const Chakkar = ({ b, tone = 'text-slate-800', children }) => (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold truncate ${tone}`}>{b.challanNo ? fmtChallan(b.challanNo) + ' · ' : ''}{fmtDate(b.date)}{b.gaadiNumber ? ' · ' + b.gaadiNumber : ''}</div>
          <div className="text-xs text-slate-400">{b.rows.length} drop{b.rows.length > 1 ? 's' : ''}{b.reason ? ` · ${b.reason}` : ''}</div>
        </div>
        <div className="text-sm font-bold font-mono text-slate-800">₹{fmtNum(b.total)}</div>
      </div>
      {children && <div className="flex gap-2 mt-2">{children}</div>}
    </div>
  )

  const Section = ({ title, count, children }) => (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 font-bold text-slate-700 text-sm">{title}{count ? ` (${count})` : ''}</div>
      {children}
    </Card>
  )

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <Toast msg={msg} />

      <Card className="p-5">
        <div className="text-xs text-slate-500 uppercase tracking-wide font-bold">Balance due to you</div>
        <div className="text-3xl font-bold text-slate-800 font-mono mt-1">₹{fmtNum(balance)}</div>
        {from && <p className="text-[11px] text-slate-400 mt-2">This period (since last settlement {fmtDate(from)}).</p>}
      </Card>

      {needs.length > 0 && (
        <Section title="⚠️ Needs correction" count={needs.length}>
          <div className="divide-y divide-slate-100">
            {needs.map(b => (
              <Chakkar key={b.batchId} b={b} tone="text-amber-700">
                <Button size="sm" variant="primary" onClick={() => onEdit(b.rows)}>Fix &amp; resubmit</Button>
                <Button size="sm" variant="neutral" onClick={() => withdraw(b)}>Remove</Button>
              </Chakkar>
            ))}
          </div>
        </Section>
      )}

      <Section title="Waiting for approval" count={pending.length}>
        {pending.length === 0 ? <div className="p-5 text-center text-slate-400 text-sm">Nothing waiting.</div> : (
          <div className="divide-y divide-slate-100">
            {pending.map(b => (
              <Chakkar key={b.batchId} b={b}>
                <Button size="sm" variant="primary" onClick={() => onEdit(b.rows)}>Edit</Button>
                <Button size="sm" variant="neutral" onClick={() => withdraw(b)}>Remove</Button>
              </Chakkar>
            ))}
          </div>
        )}
      </Section>

      <Section title="Approved" count={passed.length}>
        {passed.length === 0 ? <div className="p-5 text-center text-slate-400 text-sm">None yet.</div> : (
          <div className="divide-y divide-slate-100">{passed.map(b => <Chakkar key={b.batchId} b={b} />)}</div>
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
          <div className="divide-y divide-slate-100 opacity-60">{cancelled.map(b => <Chakkar key={b.batchId} b={b} tone="text-slate-500" />)}</div>
        </Section>
      )}
    </div>
  )
}
