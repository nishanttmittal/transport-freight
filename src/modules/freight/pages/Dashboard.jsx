/**
 * Dashboard — owner/staff overview. Headline strip (today's freight, transporters,
 * total outstanding), the threshold banner, then one card per transporter sorted
 * by balance (worst first). Tap a card to expand its freight/advance/balance split.
 */
import { useState } from 'react'
import { Card } from '../../../core/ui'
import { fmtNum, todayStr } from '../../../core/utils/format'
import { useFreight } from '../FreightContext'
import { entryTotal, transporterTotals, unsettledFrom, openingBalance, thresholdLevel } from '../logic/calc'
import { countsInHisab } from '../logic/status'
import { levelStyle } from '../logic/balance'
import ThresholdBanner, { balanceOf } from '../ThresholdBanner'
import { THRESHOLD_LEVELS } from '../config'

const active = (list) => (list || []).filter(x => !x.deleted)

export default function Dashboard() {
  const { transporters, entries, advances, settlements } = useFreight()
  const [openId, setOpenId] = useState('')

  const state = { entries: entries.list, advances: advances.list, settlements: settlements.list }
  const tList = active(transporters.list)

  const today = todayStr()
  // Only PASSED trips count as real freight — exclude pending/cancelled/voided (P2-3).
  const todayFreight = (entries.list || []).filter(e => e.date === today && countsInHisab(e)).reduce((s, e) => s + entryTotal(e), 0)
  const rows = tList
    .map(t => ({ t, bal: balanceOf(t, state) }))
    .sort((a, b) => b.bal - a.bal)
  const outstanding = rows.reduce((s, r) => s + r.bal, 0)

  const stat = (n, l) => (
    <div className="bg-white/10 rounded-xl px-3 py-2.5 flex-1 text-center">
      <div className="text-xl font-bold">{n}</div><div className="text-[11px] text-slate-300 mt-0.5">{l}</div>
    </div>
  )

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white rounded-2xl p-4">
        <div className="flex gap-2">
          {stat(`₹${fmtNum(todayFreight)}`, 'Freight today')}
          {stat(tList.length, 'Gaadiwalas')}
          {stat(`₹${fmtNum(outstanding)}`, 'Outstanding')}
        </div>
      </div>

      <ThresholdBanner transporters={tList} state={state} onOpen={setOpenId} />

      <div className="space-y-2">
        {rows.length === 0 && <Card className="p-6 text-center text-slate-400 text-sm">No gaadiwalas yet. Add one from the Entry screen.</Card>}
        {rows.map(({ t, bal }) => {
          const level = thresholdLevel(bal, THRESHOLD_LEVELS)
          const s = levelStyle(level)
          const from = unsettledFrom(settlements.list, t.id)
          const opening = openingBalance(settlements.list, t.id)   // include carried-forward remainder
          const tot = transporterTotals(entries.list, advances.list, t.id, { from, opening })
          const runningTotal = tot.opening + tot.freight  // running hisab total (excl. settled), incl. carry-forward
          const isOpen = openId === t.id
          return (
            <Card key={t.id} className={`p-4 ${level > 0 ? 'ring-1 ' + s.ring : ''}`}>
              <button className="w-full flex items-center justify-between text-left" onClick={() => setOpenId(isOpen ? '' : t.id)}>
                <div className="min-w-0">
                  <div className="font-bold text-slate-800 truncate">{t.name}</div>
                  {t.phone && <div className="text-xs text-slate-400">{t.phone}</div>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {level > 0 && <span className={`${s.bg} ${s.text} text-[10px] font-bold rounded-full px-2 py-0.5`}>{s.label}</span>}
                  <span className="text-lg font-bold font-mono text-slate-800">₹{fmtNum(bal)}</span>
                </div>
              </button>
              {/* Running hisab only (settled history excluded): total billed + total paid. */}
              <div className="mt-1.5 flex items-center gap-4 text-xs text-slate-500">
                <span>Total <span className="font-bold text-slate-700 font-mono">₹{fmtNum(runningTotal)}</span></span>
                <span>Paid <span className="font-bold text-emerald-600 font-mono">₹{fmtNum(tot.advances)}</span></span>
              </div>
              {isOpen && (
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-center text-sm">
                  <div><div className="text-slate-400 text-xs">Freight</div><div className="font-bold">₹{fmtNum(tot.freight)}</div></div>
                  <div><div className="text-slate-400 text-xs">Advances</div><div className="font-bold text-emerald-600">₹{fmtNum(tot.advances)}</div></div>
                  <div><div className="text-slate-400 text-xs">Balance</div><div className="font-bold">₹{fmtNum(tot.balance)}</div></div>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
