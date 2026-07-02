/**
 * Hisab — one transporter's running account. Shows the UNSETTLED window (since
 * the last locked settlement): dated freight + advance lines with a running
 * balance, the summary, the threshold band, and a Settle action that snapshots +
 * locks the period, resets the running balance, and shares a PDF statement.
 */
import { useState } from 'react'
import { Button, Card, FieldLabel, Select, useToast, Toast } from '../../../core/ui'
import { fmtNum, fmtDate, todayStr } from '../../../core/utils/format'
import { useFreight } from '../FreightContext'
import { ledgerLines, transporterTotals, unsettledFrom, thresholdLevel } from '../logic/calc'
import { levelStyle } from '../logic/balance'
import { shareStatementPdf, statementHash } from '../logic/pdf'
import { THRESHOLD_LEVELS, fmtChallan } from '../config'

const active = (list) => (list || []).filter(x => !x.deleted)

export default function Hisab({ owner = false, by = '' }) {
  const { transporters, destinations, entries, advances, settlements, log, allocateNumber } = useFreight()
  const { msg, show } = useToast()
  const [tid, setTid] = useState('')

  const tList = active(transporters.list).filter(t => t.active !== false)
  const destName = (id) => (destinations.list.find(d => d.id === id)?.name) || '—'
  const transporter = transporters.list.find(t => t.id === tid)

  const from = tid ? unsettledFrom(settlements.list, tid) : ''
  const lines = tid ? ledgerLines(entries.list, advances.list, tid, { from }) : []
  const totals = tid ? transporterTotals(entries.list, advances.list, tid, { from }) : { freight: 0, advances: 0, balance: 0 }
  const level = thresholdLevel(totals.balance, THRESHOLD_LEVELS)
  const style = levelStyle(level)

  const options = [{ value: '', label: 'Select gaadiwala' }, ...tList.map(t => ({ value: t.id, label: t.name }))]

  const doShare = () => {
    if (!transporter) return
    shareStatementPdf({ transporterName: transporter.name, lines, destName, totals, period: { from, to: todayStr() } })
  }

  const doSettle = async () => {
    if (!transporter) return
    if (!lines.length) return show('Nothing to settle', 2000)
    if (!window.confirm(`Settle ${transporter.name}'s hisab up to today?\n\nBalance ₹${fmtNum(totals.balance)} will be locked. New entries start a fresh period.`)) return
    const settlementNo = await allocateNumber('settlement')
    const period = { from, to: todayStr() }
    const pdfHash = await statementHash({ transporterName: transporter.name, lines, destName, totals, period })
    const tripCount = lines.filter(l => l.kind === 'freight').length
    settlements.insert({
      transporterId: tid,
      periodFrom: from,
      periodTo: todayStr(),
      totalFreight: totals.freight,
      totalAdvances: totals.advances,
      balance: totals.balance,
      finalizedBy: by || (owner ? 'Owner' : 'Staff'),
      locked: true,
      settlementNo,
      settledAt: new Date().toISOString(),
      settledBy: by || (owner ? 'Owner' : 'Staff'),
      transporterName: transporter.name,
      tripCount,
      totalPayments: totals.advances,
      closingBalance: totals.balance,
      pdfHash,
      factoryId: 'main',
    })
    transporters.update(tid, { runningBalance: 0, alertedLevel: 0 })
    log('hisab.settle', `SET-${String(settlementNo).padStart(4, '0')} ${transporter.name} ₹${fmtNum(totals.balance)}`, by, tid)
    show('Settled & locked ✓')
    doShare()
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <Toast msg={msg} />

      <Card className="p-4">
        <FieldLabel>Gaadiwala</FieldLabel>
        <div className="mt-1.5"><Select options={options} value={tid} onChange={e => setTid(e.target.value)} /></div>
      </Card>

      {tid && (
        <>
          <Card className={`p-5 ring-2 ${style.ring}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wide font-bold">Balance due</div>
                <div className="text-3xl font-bold text-slate-800 font-mono mt-1">₹{fmtNum(totals.balance)}</div>
              </div>
              {level > 0 && <span className={`${style.bg} ${style.text} text-xs font-bold rounded-full px-3 py-1.5`}>{style.label}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
              <div className="bg-slate-50 rounded-xl p-3"><div className="text-slate-500 text-xs">Total Freight</div><div className="font-bold text-slate-800">₹{fmtNum(totals.freight)}</div></div>
              <div className="bg-slate-50 rounded-xl p-3"><div className="text-slate-500 text-xs">Less Advances</div><div className="font-bold text-slate-800">₹{fmtNum(totals.advances)}</div></div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="neutral" className="flex-1" onClick={doShare}>📄 Share PDF</Button>
              {owner && <Button variant="success" className="flex-1" onClick={doSettle}>✓ Settle hisab</Button>}
            </div>
            {from && <p className="text-[11px] text-slate-400 mt-3">Showing activity after last settlement ({fmtDate(from)}).</p>}
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 font-bold text-slate-700 text-sm">Ledger</div>
            {lines.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-sm">No activity yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {[...lines].reverse().map(l => (
                  <div key={l.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">
                        {l.kind === 'advance' ? `Advance${l.paidBy ? ' · ' + l.paidBy : ''}` : `${l.challanNo ? fmtChallan(l.challanNo) + ' · ' : ''}${destName(l.destinationId)}${l.gaadiNumber ? ' · ' + l.gaadiNumber : ''}`}
                      </div>
                      <div className="text-xs text-slate-400">{fmtDate(l.date)}{l.kind === 'freight' && l.bags ? ` · ${l.bags} bags` : ''}{l.kind === 'advance' && l.note ? ` · ${l.note}` : ''}</div>
                    </div>
                    <div className={`text-sm font-bold font-mono ${l.kind === 'advance' ? 'text-emerald-600' : 'text-slate-800'}`}>{l.kind === 'advance' ? '−' : '+'}₹{fmtNum(l.amount)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
