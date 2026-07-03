/**
 * GaadiwalaChakkarList — the gaadiwala's own chakkars as a detailed, chakkar-wise
 * list shown BELOW his entry form. Each card = one chakkar (batch) with its status
 * (Pending → Approved once we pass it), date, challan, drops and total.
 */
import { Card } from '../../../core/ui'
import { fmtNum, fmtDate } from '../../../core/utils/format'
import { useFreight } from '../FreightContext'
import { entryTotal, unsettledFrom } from '../logic/calc'
import { STATUS } from '../logic/status'
import { fmtChallan } from '../config'

const LABEL = { pending: '⏳ Pending', needs_correction: '⚠️ Returned', passed: '✅ Approved', cancelled: '❌ Cancelled' }
const STYLE = { pending: 'text-amber-700 bg-amber-50', needs_correction: 'text-orange-700 bg-orange-50', passed: 'text-emerald-700 bg-emerald-50', cancelled: 'text-slate-500 bg-slate-100' }

function groupBatches(rows) {
  const map = new Map()
  for (const r of rows) { const k = r.batchId || r.id; if (!map.has(k)) map.set(k, []); map.get(k).push(r) }
  return [...map.values()].map(list => ({
    batchId: list[0].batchId || list[0].id, rows: list, date: list[0].date,
    challanNo: list[0].challanNo, status: list[0].status || STATUS.passed,
    total: list.reduce((s, r) => s + entryTotal(r), 0),
  }))
}

export default function GaadiwalaChakkarList({ transporterId }) {
  const { entries, destinations, settlements } = useFreight()
  const destName = (id) => destinations.list.find(d => d.id === id)?.name || ''
  // only this (unsettled) period — chakkars clear once the hisab is settled
  const from = unsettledFrom(settlements.list, transporterId)
  const inWindow = (d) => !from || (d || '') > from
  const mine = (entries.list || []).filter(e => e.transporterId === transporterId && !e.deleted && (e.status || STATUS.passed) !== STATUS.voided && inWindow(e.date))
  const batches = groupBatches(mine)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (Number(b.challanNo) || 0) - (Number(a.challanNo) || 0))
    .slice(0, 50)

  return (
    <div className="max-w-lg mx-auto px-4 pb-40 space-y-2">
      <div className="pt-3">
        <div className="font-bold text-slate-700 text-sm">Your chakkars ({batches.length})</div>
        <div className="text-[11px] text-slate-400">This period — until your hisab is settled.</div>
      </div>
      {batches.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-6">No chakkars yet — add one above.</div>
      ) : batches.map(b => (
        <Card key={b.batchId} className="p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-800 truncate">{b.challanNo ? fmtChallan(b.challanNo) + ' · ' : ''}{fmtDate(b.date)}</div>
            <span className={`text-[11px] font-bold rounded-lg px-2 py-0.5 flex-shrink-0 ${STYLE[b.status] || STYLE.passed}`}>{LABEL[b.status] || b.status}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">{b.rows.length} drop{b.rows.length > 1 ? 's' : ''} · <span className="font-mono font-bold text-slate-700">₹{fmtNum(b.total)}</span></div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">{b.rows.map(r => destName(r.destinationId)).filter(Boolean).join(', ') || '—'}</div>
        </Card>
      ))}
    </div>
  )
}
