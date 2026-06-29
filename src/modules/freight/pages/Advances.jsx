/**
 * Advances — money paid to a gaadiwala, by Nishant or Anshul. Each advance
 * reduces that transporter's running balance. Reverse (owner) adds it back —
 * never a hard delete. Advances in a locked (settled) period can't be changed.
 */
import { useState } from 'react'
import { Button, Card, FieldLabel, TextInput, NumberInput, DateInput, Select, useToast, Toast } from '../../../core/ui'
import { todayStr, fmtNum, fmtDate } from '../../../core/utils/format'
import { useFreight } from '../FreightContext'
import { lockedOn } from '../logic/calc'
import { applyBalance } from '../logic/balance'
import { PAID_BY } from '../config'

const active = (list) => (list || []).filter(x => !x.deleted)

export default function Advances({ owner = false, by = '' }) {
  const { transporters, advances, settlements, log } = useFreight()
  const { msg, show } = useToast()
  const [form, setForm] = useState({ date: todayStr(), transporterId: '', amount: '', paidBy: PAID_BY[0], note: '' })
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const tList = active(transporters.list).filter(t => t.active !== false)
  const tName = (id) => transporters.list.find(t => t.id === id)?.name || '—'
  const options = [{ value: '', label: 'Select transporter' }, ...tList.map(t => ({ value: t.id, label: t.name }))]

  const save = () => {
    const amt = Number(form.amount) || 0
    if (!form.transporterId) return show('Pick a transporter', 2000)
    if (amt <= 0) return show('Enter an amount', 2000)
    if (lockedOn(settlements.list, form.transporterId, form.date)) return show('This period is settled & locked', 2600)
    advances.insert({ date: form.date, transporterId: form.transporterId, amount: amt, paidBy: form.paidBy, note: form.note.trim(), reversed: false, deleted: false, createdByUser: by || '' })
    applyBalance(transporters, form.transporterId, -amt)
    log('advance.add', `${tName(form.transporterId)} ₹${amt} by ${form.paidBy}`, by, form.transporterId)
    setForm(f => ({ ...f, amount: '', note: '' }))
    show('Advance saved ✓')
  }

  const reverse = (a) => {
    if (lockedOn(settlements.list, a.transporterId, a.date)) return show('Settled — cannot reverse', 2600)
    if (!window.confirm(`Reverse ₹${fmtNum(a.amount)} advance to ${tName(a.transporterId)}?`)) return
    advances.update(a.id, { reversed: true })
    applyBalance(transporters, a.transporterId, +Number(a.amount) || 0)
    log('advance.reverse', `${tName(a.transporterId)} ₹${a.amount}`, by, a.transporterId)
    show('Reversed')
  }

  const recent = active(advances.list).slice().sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.createdAt || '').localeCompare(x.createdAt || '')).slice(0, 30)

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <Toast msg={msg} />
      <Card className="p-4 space-y-4">
        <div><FieldLabel>Date</FieldLabel><div className="mt-1.5"><DateInput value={form.date} onChange={set('date')} /></div></div>
        <div><FieldLabel>Transporter</FieldLabel><div className="mt-1.5"><Select options={options} value={form.transporterId} onChange={set('transporterId')} /></div></div>
        <div><FieldLabel>Amount (₹)</FieldLabel><div className="mt-1.5"><NumberInput value={form.amount} placeholder="0" onChange={set('amount')} /></div></div>
        <div>
          <FieldLabel>Paid by</FieldLabel>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {PAID_BY.map(p => (
              <button key={p} type="button" onClick={() => setForm(f => ({ ...f, paidBy: p }))}
                className={`py-3 rounded-2xl font-bold border-2 ${form.paidBy === p ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200'}`}>{p}</button>
            ))}
          </div>
        </div>
        <div><FieldLabel>Note</FieldLabel><div className="mt-1.5"><TextInput value={form.note} placeholder="optional" onChange={set('note')} /></div></div>
        <Button size="lg" variant="success" className="w-full" onClick={save}>Save advance</Button>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-bold text-slate-700 text-sm">Recent advances</div>
        {recent.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-sm">No advances yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recent.map(a => (
              <div key={a.id} className={`px-4 py-3 flex items-center gap-3 ${a.reversed ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">{tName(a.transporterId)}{a.reversed ? ' · reversed' : ''}</div>
                  <div className="text-xs text-slate-400">{fmtDate(a.date)} · {a.paidBy}{a.note ? ' · ' + a.note : ''}</div>
                </div>
                <div className="text-sm font-bold font-mono text-emerald-600">₹{fmtNum(a.amount)}</div>
                {owner && !a.reversed && <button onClick={() => reverse(a)} className="text-xs font-bold text-red-500 bg-red-50 rounded-lg px-2.5 py-1.5">Reverse</button>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
