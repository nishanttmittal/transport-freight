/**
 * Hisab — one transporter's running account. Shows the UNSETTLED window (since
 * the last locked settlement): dated freight + advance lines with a running
 * balance, the summary, the threshold band, and a Settle action that snapshots +
 * locks the period, resets the running balance, and shares a PDF statement.
 */
import { useState } from 'react'
import { Button, Card, FieldLabel, Select, NumberInput, TextInput, useToast, Toast } from '../../../core/ui'
import { fmtNum, fmtDate, todayStr } from '../../../core/utils/format'
import { useFreight } from '../FreightContext'
import { ledgerLines, transporterTotals, unsettledFrom, openingBalance, thresholdLevel } from '../logic/calc'
import { levelStyle } from '../logic/balance'
import { shareStatementPdf } from '../logic/pdf'
import { auditLine } from '../logic/audit'
import { canonicalSettlement, sha256hex } from '../logic/hash'
import { makeId } from '../../../core/db/repository'
import { THRESHOLD_LEVELS, PAID_BY, fmtChallan, fmtPayment } from '../config'
import Entry from './Entry'

const active = (list) => (list || []).filter(x => !x.deleted)

export default function Hisab({ owner = false, by = '' }) {
  const { transporters, destinations, entries, advances, settlements, logs, log, allocateNumber, settleBatch } = useFreight()
  const { msg, show } = useToast()
  const [tid, setTid] = useState('')
  const [editBatch, setEditBatch] = useState(null)
  const [settling, setSettling] = useState(false)   // pay-and-settle panel open
  const [payAmt, setPayAmt] = useState('')
  const [paidBy, setPaidBy] = useState(PAID_BY[0])
  const [payNote, setPayNote] = useState('')
  const [busy, setBusy] = useState(false)
  const openEdit = (l) => {
    const e0 = entries.list.find(x => x.id === l.id); if (!e0) return
    const rows = active(entries.list).filter(e => e.batchId === e0.batchId)
    setEditBatch(rows.length ? rows : [e0])
  }

  const tList = active(transporters.list).filter(t => t.active !== false)
  const destName = (id) => (destinations.list.find(d => d.id === id)?.name) || '—'
  const transporter = transporters.list.find(t => t.id === tid)

  const from = tid ? unsettledFrom(settlements.list, tid) : ''
  const opening = tid ? openingBalance(settlements.list, tid) : 0
  const lines = tid ? ledgerLines(entries.list, advances.list, tid, { from, opening }) : []
  const totals = tid ? transporterTotals(entries.list, advances.list, tid, { from, opening }) : { freight: 0, advances: 0, opening: 0, balance: 0 }
  const level = thresholdLevel(totals.balance, THRESHOLD_LEVELS)
  const style = levelStyle(level)

  const options = [{ value: '', label: 'Select gaadiwala' }, ...tList.map(t => ({ value: t.id, label: t.name }))]

  const doShare = (finalLines = lines, finalTotals = totals) => {
    if (!transporter) return
    shareStatementPdf({ transporterName: transporter.name, lines: finalLines, destName, totals: finalTotals, period: { from, to: todayStr() } })
  }

  const openSettle = () => {
    setPayAmt(totals.balance > 0 ? String(totals.balance) : '')  // default = pay the full balance due
    setPaidBy(PAID_BY[0]); setPayNote(''); setSettling(true)
  }

  const doPayAndSettle = async () => {
    if (!transporter) return
    if (!lines.length && !opening) return show('Nothing to settle', 2000)
    const pay = Math.max(0, Number(payAmt) || 0)
    const closing = totals.balance - pay
    const carryMsg = closing > 0 ? `Remaining ₹${fmtNum(closing)} carries to next hisab.`
      : closing < 0 ? `Advance of ₹${fmtNum(-closing)} carries forward.` : 'Balance cleared to ₹0.'
    if (!window.confirm(`Settle ${transporter.name}?\n\nBalance due: ₹${fmtNum(totals.balance)}\nPay now: ₹${fmtNum(pay)} (${paidBy})\n${carryMsg}`)) return
    if (busy) return
    setBusy(true)
    try {
      const to = todayStr()
      const byName = by || (owner ? 'Owner' : 'Staff')
      const roleName = owner ? 'owner' : 'incharge'
      // Numbers come from their own atomic counter txns FIRST (before the batch).
      const paymentNo = pay > 0 ? await allocateNumber('payment') : 0
      const settlementNo = await allocateNumber('settlement')
      const tripCount = lines.filter(l => l.kind === 'freight').length

      // Build the settlement payment (if any) client-side so its id is fixed
      // both in the ledger snapshot and in the atomic write.
      let payment = null, payLine = null
      if (pay > 0) {
        const pid = makeId('r')
        payment = { id: pid, date: to, transporterId: tid, transporterName: transporter.name, amount: pay, paidBy, note: payNote.trim() || 'settlement payment', paymentNo, reversal: false, reversed: false, factoryId: 'main', deleted: false, createdByUser: by || '' }
        payLine = { id: pid, date: to, kind: 'advance', paidBy, note: payment.note, amount: pay, debit: 0, credit: pay, balance: closing }
      }
      // Snapshot + lock the period (closing = what's still owed → carries forward).
      const snapshot = {
        transporterId: tid, periodFrom: from, periodTo: to,
        totalFreight: totals.freight, totalPayments: totals.advances + pay, closingBalance: closing,
        settlementNo, transporterName: transporter.name,
        lineIds: lines.filter(l => l.kind !== 'opening').map(l => l.id).concat(payLine ? [payLine.id] : []),
      }
      const settlementHash = await sha256hex(canonicalSettlement(snapshot)) // reproducible fingerprint
      const settlement = {
        id: makeId('r'), transporterId: tid, periodFrom: from, periodTo: to, openingBalance: opening,
        totalFreight: totals.freight, totalAdvances: totals.advances + pay, balance: closing,
        finalizedBy: byName, locked: true, settlementNo,
        settledAt: new Date().toISOString(), settledBy: byName,
        transporterName: transporter.name, tripCount, totalPayments: totals.advances + pay,
        closingBalance: closing, settlementHash, pdfHash: '', factoryId: 'main',
      }

      // ONE atomic write: payment + settlement + carried-forward running balance.
      await settleBatch({
        payment, settlement, transporterId: tid,
        transporterPatch: { runningBalance: closing, alertedLevel: thresholdLevel(closing, THRESHOLD_LEVELS) },
      })

      // Non-critical after the money is safely committed (best-effort logs).
      if (pay > 0) {
        log('advance.add', `${fmtPayment(paymentNo)} ${transporter.name} ₹${pay} by ${paidBy}`, by, tid)
        logs.insert(auditLine('payment.add', { by, role: roleName, after: payment, device: navigator.userAgent }))
      }
      log('hisab.settle', `SET-${String(settlementNo).padStart(4, '0')} ${transporter.name} paid ₹${fmtNum(pay)} carry ₹${fmtNum(closing)}`, by, tid)
      setSettling(false)
      show(closing === 0 ? 'Settled & cleared ✓' : `Settled ✓ · ₹${fmtNum(closing)} carried forward`)
      doShare(payLine ? [...lines, payLine] : lines, { ...totals, advances: totals.advances + pay, balance: closing })
    } catch { show('Could not settle — check internet and try again', 2600) } finally { setBusy(false) }
  }

  if (editBatch) {
    return <Entry editBatch={editBatch} ownerEdit lockTransporterId={tid} lockTransporterName={transporter?.name || ''} by={by} level={owner ? 'owner' : 'incharge'} onDone={() => setEditBatch(null)} />
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
              {totals.opening ? <div className="bg-amber-50 rounded-xl p-3"><div className="text-amber-600 text-xs">Brought forward</div><div className="font-bold text-amber-800">₹{fmtNum(totals.opening)}</div></div> : null}
              <div className="bg-slate-50 rounded-xl p-3"><div className="text-slate-500 text-xs">Total Freight</div><div className="font-bold text-slate-800">₹{fmtNum(totals.freight)}</div></div>
              <div className="bg-slate-50 rounded-xl p-3"><div className="text-slate-500 text-xs">Less Advances</div><div className="font-bold text-slate-800">₹{fmtNum(totals.advances)}</div></div>
            </div>

            {settling ? (
              <div className="mt-4 border-2 border-emerald-200 rounded-2xl p-4 space-y-3 bg-emerald-50/40">
                <div className="text-sm font-bold text-slate-700">Pay &amp; settle</div>
                <div>
                  <FieldLabel>Pay now (₹) — leave blank to settle without paying</FieldLabel>
                  <div className="mt-1.5"><NumberInput value={payAmt} placeholder="0" onChange={e => setPayAmt(e.target.value)} /></div>
                  <p className="text-[11px] text-slate-500 mt-1">Remaining after payment: <span className="font-bold">₹{fmtNum(totals.balance - (Number(payAmt) || 0))}</span> {(totals.balance - (Number(payAmt) || 0)) === 0 ? '(cleared)' : 'carries to next hisab'}</p>
                </div>
                <div>
                  <FieldLabel>Paid by</FieldLabel>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    {PAID_BY.map(p => (
                      <button key={p} type="button" onClick={() => setPaidBy(p)}
                        className={`py-3 rounded-2xl font-bold border-2 ${paidBy === p ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200'}`}>{p}</button>
                    ))}
                  </div>
                </div>
                <div><FieldLabel>Note</FieldLabel><div className="mt-1.5"><TextInput value={payNote} placeholder="optional" onChange={e => setPayNote(e.target.value)} /></div></div>
                <div className="flex gap-2">
                  <Button variant="neutral" className="flex-1" onClick={() => setSettling(false)} disabled={busy}>Cancel</Button>
                  <Button variant="success" className="flex-1" onClick={doPayAndSettle} disabled={busy}>{busy ? 'Settling…' : '✓ Pay & Settle'}</Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mt-4">
                <Button variant="neutral" className="flex-1" onClick={() => doShare()}>📄 Share PDF</Button>
                {owner && <Button variant="success" className="flex-1" onClick={openSettle}>✓ Settle hisab</Button>}
              </div>
            )}
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
                        {l.kind === 'opening' ? 'Brought forward' : l.kind === 'advance' ? `Advance${l.paidBy ? ' · ' + l.paidBy : ''}` : `${l.challanNo ? fmtChallan(l.challanNo) + ' · ' : ''}${destName(l.destinationId)}${l.gaadiNumber ? ' · ' + l.gaadiNumber : ''}`}
                      </div>
                      <div className="text-xs text-slate-400">{l.kind === 'opening' ? 'from last hisab' : fmtDate(l.date)}{l.kind === 'freight' && l.bags ? ` · ${l.bags} bags` : ''}{l.kind === 'advance' && l.note ? ` · ${l.note}` : ''}</div>
                    </div>
                    <div className={`text-sm font-bold font-mono ${l.kind === 'advance' ? 'text-emerald-600' : 'text-slate-800'}`}>{l.kind === 'advance' ? '−' : '+'}₹{fmtNum(l.amount)}</div>
                    {l.kind === 'freight' && <button onClick={() => openEdit(l)} className="text-xs font-bold text-indigo-600 bg-indigo-50 rounded-lg px-2.5 py-1.5">Edit</button>}
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
