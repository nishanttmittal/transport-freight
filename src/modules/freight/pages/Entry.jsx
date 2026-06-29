/**
 * Entry — record ONE drop to ONE transport. Each drop carries its own freight.
 * A multi-drop vehicle = save 2-3 drops in a row sharing the same gaadi number
 * (the form keeps date + transporter + gaadi after save); add the extra-point ₹
 * on the 2nd/3rd drops. The extra-point amount is free-typed (+50 same / +200 far).
 */
import { useState } from 'react'
import { Button, Card, FieldLabel, TextInput, NumberInput, DateInput, Select, NumberStepper, useToast, Toast } from '../../../core/ui'
import { todayStr, fmtNum, fmtDate } from '../../../core/utils/format'
import { makeId } from '../../../core/db/repository'
import { useFreight } from '../FreightContext'
import { entryTotal, lockedOn } from '../logic/calc'
import { applyBalance } from '../logic/balance'
import { EXTRA_POINT_HINT, QUICK_BAGS } from '../config'

const ADD = '__add__'
const active = (list) => (list || []).filter(x => !x.deleted && x.active !== false)

export default function Entry({ by = '', level = '' }) {
  const { transporters, destinations, entries, settlements, lastUsed, log } = useFreight()
  const { msg, show } = useToast()

  const remembered = lastUsed.get() || {}
  const [form, setForm] = useState(() => ({
    date: todayStr(),
    transporterId: '',
    gaadiNumber: remembered.gaadiNumber || '',
    destinationId: '',
    bags: '',
    pvtMarka: '',
    freight: '', lrCharge: '', unloading: '', misc: '', extraPoint: '',
    remarks: '',
  }))
  const [batchId, setBatchId] = useState('')
  const [dropCount, setDropCount] = useState(0)
  const [adding, setAdding] = useState('') // '' | 'transporter' | 'destination'
  const [newName, setNewName] = useState('')

  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }))
  const setEv = (k) => (e) => set(k)(e.target.value)

  const tList = active(transporters.list)
  const dList = active(destinations.list)
  const total = entryTotal({ freight: form.freight, lrCharge: form.lrCharge, unloading: form.unloading, misc: form.misc, extraPoint: form.extraPoint })

  const tOptions = [{ value: '', label: 'Select transporter' }, ...tList.map(t => ({ value: t.id, label: t.name })), { value: ADD, label: '＋ Add new transporter' }]
  const dOptions = [{ value: '', label: 'Select transport' }, ...dList.map(d => ({ value: d.id, label: d.name })), { value: ADD, label: '＋ Add new transport' }]

  const onSelectTransporter = (e) => { const v = e.target.value; if (v === ADD) { setAdding('transporter'); setNewName('') } else set('transporterId')(v) }
  const onSelectDestination = (e) => { const v = e.target.value; if (v === ADD) { setAdding('destination'); setNewName('') } else set('destinationId')(v) }

  const saveNewMaster = () => {
    const name = newName.trim()
    if (!name) return
    if (adding === 'transporter') {
      const row = transporters.insert({ name, active: true, runningBalance: 0, alertedLevel: 0, deleted: false })
      set('transporterId')(row.id)
    } else {
      const row = destinations.insert({ name, active: true, deleted: false })
      set('destinationId')(row.id)
    }
    setAdding(''); setNewName('')
  }

  const save = () => {
    if (!form.transporterId) return show('Pick a transporter', 2000)
    if (!form.destinationId) return show('Pick a transport', 2000)
    if (lockedOn(settlements.list, form.transporterId, form.date)) return show('This period is settled & locked', 2600)

    const bId = batchId || makeId('batch')
    const rec = {
      date: form.date,
      transporterId: form.transporterId,
      gaadiNumber: form.gaadiNumber.trim(),
      destinationId: form.destinationId,
      bags: Number(form.bags) || 0,
      pvtMarka: form.pvtMarka.trim(),
      freight: Number(form.freight) || 0,
      lrCharge: Number(form.lrCharge) || 0,
      unloading: Number(form.unloading) || 0,
      misc: Number(form.misc) || 0,
      extraPoint: Number(form.extraPoint) || 0,
      remarks: form.remarks.trim(),
      batchId: bId,
      createdByRole: level || '',
      createdByUser: by || '',
      sourceApp: 'transportfreight',
      workflowStage: 'transport',
      factoryId: 'main',
      deleted: false,
    }
    const rowTotal = entryTotal(rec)
    entries.insert(rec)
    const crossed = applyBalance(transporters, form.transporterId, +rowTotal)
    log('entry.add', `${fmtDate(rec.date)} ₹${rowTotal}`, by, bId)
    lastUsed.set({ ...(lastUsed.get() || {}), gaadiNumber: rec.gaadiNumber })

    setBatchId(bId)
    setDropCount(c => c + 1)
    // keep date + transporter + gaadi for the next drop of the same vehicle
    setForm(f => ({ ...f, destinationId: '', bags: '', pvtMarka: '', freight: '', lrCharge: '', unloading: '', misc: '', extraPoint: '', remarks: '' }))
    show(crossed ? `Saved · ${tList.find(t => t.id === rec.transporterId)?.name || ''} crossed ₹${fmtNum(crossed)}` : 'Saved ✓')
  }

  const newVehicle = () => { setBatchId(''); setDropCount(0); setForm(f => ({ ...f, transporterId: '', gaadiNumber: '', destinationId: '', bags: '', pvtMarka: '', freight: '', lrCharge: '', unloading: '', misc: '', extraPoint: '', remarks: '' })) }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4 pb-40">
      <Toast msg={msg} />

      {dropCount > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-center justify-between">
          <div className="text-sm text-blue-800 font-semibold">{dropCount} drop{dropCount > 1 ? 's' : ''} saved for this gaadi</div>
          <button onClick={newVehicle} className="text-xs font-bold text-blue-700 bg-white rounded-lg px-3 py-1.5 border border-blue-200">New gaadi</button>
        </div>
      )}

      <Card className="p-4 space-y-4">
        <div><FieldLabel>Date</FieldLabel><div className="mt-1.5"><DateInput value={form.date} onChange={setEv('date')} /></div></div>

        <div>
          <FieldLabel>Transporter</FieldLabel>
          <div className="mt-1.5">
            {adding === 'transporter' ? (
              <div className="flex gap-2">
                <TextInput autoFocus value={newName} placeholder="New transporter name" onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveNewMaster()} />
                <Button onClick={saveNewMaster}>Add</Button>
                <Button variant="neutral" onClick={() => setAdding('')}>✕</Button>
              </div>
            ) : (
              <Select options={tOptions} value={form.transporterId} onChange={onSelectTransporter} />
            )}
          </div>
        </div>

        <div><FieldLabel>Gaadi No</FieldLabel><div className="mt-1.5"><TextInput value={form.gaadiNumber} placeholder="e.g. HR55 1234" onChange={setEv('gaadiNumber')} /></div></div>

        <div>
          <FieldLabel>Transport (destination)</FieldLabel>
          <div className="mt-1.5">
            {adding === 'destination' ? (
              <div className="flex gap-2">
                <TextInput autoFocus value={newName} placeholder="New transport name" onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveNewMaster()} />
                <Button onClick={saveNewMaster}>Add</Button>
                <Button variant="neutral" onClick={() => setAdding('')}>✕</Button>
              </div>
            ) : (
              <Select options={dOptions} value={form.destinationId} onChange={onSelectDestination} />
            )}
          </div>
        </div>

        <div><FieldLabel>Bags</FieldLabel><div className="mt-1.5"><NumberStepper value={form.bags} onChange={set('bags')} quickAdds={QUICK_BAGS} /></div></div>
        <div><FieldLabel>Pvt Marka</FieldLabel><div className="mt-1.5"><TextInput value={form.pvtMarka} placeholder="Private marka" onChange={setEv('pvtMarka')} /></div></div>
      </Card>

      <Card className="p-4 space-y-4">
        <FieldLabel>Charges (₹)</FieldLabel>
        <div className="grid grid-cols-2 gap-3">
          <div><span className="text-xs font-semibold text-slate-500">Freight</span><NumberInput value={form.freight} placeholder="0" onChange={setEv('freight')} /></div>
          <div><span className="text-xs font-semibold text-slate-500">LR Charge</span><NumberInput value={form.lrCharge} placeholder="0" onChange={setEv('lrCharge')} /></div>
          <div><span className="text-xs font-semibold text-slate-500">Unloading</span><NumberInput value={form.unloading} placeholder="0" onChange={setEv('unloading')} /></div>
          <div><span className="text-xs font-semibold text-slate-500">Misc</span><NumberInput value={form.misc} placeholder="0" onChange={setEv('misc')} /></div>
        </div>
        <div>
          <span className="text-xs font-semibold text-slate-500">Extra Point</span>
          <NumberInput value={form.extraPoint} placeholder="0" onChange={setEv('extraPoint')} />
          <p className="text-[11px] text-slate-400 mt-1">{EXTRA_POINT_HINT}</p>
        </div>
        <div><span className="text-xs font-semibold text-slate-500">Remarks</span><TextInput value={form.remarks} placeholder="optional" onChange={setEv('remarks')} /></div>
      </Card>

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 p-3 z-20" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="flex-1"><div className="text-xs text-slate-500">Total</div><div className="text-2xl font-bold text-slate-800 font-mono">₹{fmtNum(total)}</div></div>
          <Button size="lg" variant="success" onClick={save} className="px-8">Save drop</Button>
        </div>
      </div>
    </div>
  )
}
