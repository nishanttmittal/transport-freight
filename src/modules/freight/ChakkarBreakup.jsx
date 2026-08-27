/**
 * ChakkarBreakup — the drop-wise charge detail of ONE chakkar (all the rows that
 * share a batchId). Each drop shows its transport office, bags and every nonzero
 * charge, so the single total on the card can always be traced back to the
 * amounts behind it. Display-only: totals still come from entryTotal().
 */
import { fmtNum } from '../../core/utils/format'
import { entryTotal } from './logic/calc'

const parts = (r) => [
  ['Freight', r.freight], ['Bilti Charge', r.lrCharge], ['Labour', r.unloading], ['Misc', r.misc], ['Extra Point', r.extraPoint],
].filter(([, v]) => Number(v) > 0)

export default function ChakkarBreakup({ rows = [], destName }) {
  return (
    <div className="bg-slate-50 rounded-xl p-3 space-y-2 text-xs">
      {rows.map((r, i) => (
        <div key={r.id} className={i ? 'border-t border-slate-200 pt-2 space-y-1' : 'space-y-1'}>
          <div className="flex justify-between font-semibold text-slate-700">
            <span className="truncate">{(destName && destName(r.destinationId)) || '—'}{Number(r.bags) > 0 ? ` · ${r.bags} bags` : ''}</span>
            <span className="font-mono flex-shrink-0 ml-2">₹{fmtNum(entryTotal(r))}</span>
          </div>
          {parts(r).map(([name, v]) => (
            <div key={name} className="flex justify-between text-slate-500"><span>{name}</span><span className="font-mono">₹{fmtNum(v)}</span></div>
          ))}
          {r.pvtMarka ? <div className="text-slate-400">Pvt Marka: {r.pvtMarka}</div> : null}
          {r.remarks ? <div className="text-slate-400">{r.remarks}</div> : null}
        </div>
      ))}
    </div>
  )
}
