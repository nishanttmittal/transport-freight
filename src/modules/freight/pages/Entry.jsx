/**
 * Entry — record ONE vehicle (gaadi) carrying material to SEVERAL transport
 * offices in one trip. Vehicle-level fields (date, transporter, gaadi) sit at the
 * top; then one "drop" block per transport office. The 1st drop is the primary
 * stop; each extra stop (2nd, 3rd…) adds an Extra Point charge (+50 same / +200
 * far). One Save writes each drop as its OWN row (shared gaadi+date+batchId) so
 * every transport office's amount stays clean and is never double-counted.
 */
import { useState } from 'react'
import { Button, Card, FieldLabel, TextInput, NumberInput, DateInput, Combobox, useToast, Toast } from '../../../core/ui'
import { todayStr, fmtNum, fmtDate } from '../../../core/utils/format'
import { makeId } from '../../../core/db/repository'
import { useFreight } from '../FreightContext'
import { entryTotal, lockedOn, nextChallanNo, dropError } from '../logic/calc'
import { findDuplicate } from '../logic/status'
import { outboxEntryRows } from '../logic/outbox'
import { auditLine } from '../logic/audit'
import { balanceHint } from '../logic/balance'
import { EXTRA_POINT_HINT, CHALLAN_START, fmtChallan } from '../config'

const active = (list) => (list || []).filter(x => !x.deleted && x.active !== false)
const emptyDrop = () => ({ destinationId: '', bags: '', pvtMarka: '', freight: '', lrCharge: '', unloading: '', misc: '', extraPoint: '', remarks: '' })

const dropFromRow = (r) => ({ destinationId: r.destinationId || '', bags: r.bags ? String(r.bags) : '', pvtMarka: r.pvtMarka || '', freight: r.freight ? String(r.freight) : '', lrCharge: r.lrCharge ? String(r.lrCharge) : '', unloading: r.unloading ? String(r.unloading) : '', misc: r.misc ? String(r.misc) : '', extraPoint: r.extraPoint ? String(r.extraPoint) : '', remarks: r.remarks || '' })

export default function Entry({ by = '', level = '', pendingMode = false, lockTransporterId = '', lockTransporterName = '', editBatch = null, ownerEdit = false, onDone = null }) {
  const { transporters, destinations, entries, settlements, lastUsed, logs, log, outbox } = useFreight()
  const { msg, show } = useToast()
  const [busy, setBusy] = useState(false)
  const editing = Array.isArray(editBatch) && editBatch.length > 0

  const remembered = lastUsed.get() || {}
  const [veh, setVeh] = useState(() => editing
    ? { date: editBatch[0].date, transporterId: editBatch[0].transporterId, gaadiNumber: editBatch[0].gaadiNumber || '' }
    : { date: todayStr(), transporterId: lockTransporterId || '', gaadiNumber: remembered.gaadiNumber || '' })
  const [drops, setDrops] = useState(() => editing ? editBatch.map(dropFromRow) : [emptyDrop()])

  const setVehField = (k) => (v) => setVeh(s => ({ ...s, [k]: v }))
  const setDropField = (i, k) => (v) => setDrops(ds => ds.map((d, idx) => idx === i ? { ...d, [k]: v } : d))

  const tList = active(transporters.list)
  const dList = active(destinations.list)
  const grandTotal = drops.reduce((s, d) => s + entryTotal(d), 0)
  const challanNo = nextChallanNo(entries.list, CHALLAN_START) // the number this Save will get

  const tItems = tList.map(t => ({ value: t.id, label: t.name }))
  const dItems = dList.map(d => ({ value: d.id, label: d.name }))

  const setGaadi = (e) => setVehField('gaadiNumber')(e.target.value.replace(/\D/g, '').slice(0, 4))

  // Add-a-master-and-pick-it in one tap (fired by the Combobox "＋ Add …" row).
  const addTransporter = (name) => {
    if (!name) return
    const row = transporters.insert({ name, active: true, runningBalance: 0, alertedLevel: 0, deleted: false })
    setVehField('transporterId')(row.id)
  }
  const addDestination = (i, name) => {
    if (!name) return
    const row = destinations.insert({ name, active: true, deleted: false })
    setDropField(i, 'destinationId')(row.id)
  }

  const addDrop = () => setDrops(ds => [...ds, emptyDrop()])
  const removeDrop = (i) => setDrops(ds => ds.filter((_, idx) => idx !== i))

  const rowFields = (d) => ({
    destinationId: d.destinationId, bags: Number(d.bags) || 0, pvtMarka: d.pvtMarka.trim(),
    freight: Number(d.freight) || 0, lrCharge: Number(d.lrCharge) || 0, unloading: Number(d.unloading) || 0,
    misc: Number(d.misc) || 0, extraPoint: Number(d.extraPoint) || 0, remarks: d.remarks.trim(),
  })

  const save = async () => {
    if (!veh.transporterId) return show('Pick a gaadiwala', 2000)
    for (let i = 0; i < drops.length; i++) {
      if (!drops[i].destinationId) return show(`Pick transport for drop ${i + 1}`, 2200)
      const err = dropError(drops[i]) // block negative charges / zero-total (P1-3)
      if (err) return show(`Drop ${i + 1}: ${err}`, 2800)
    }
    if (!editing && lockedOn(settlements.list, veh.transporterId, veh.date)) return show('This period is settled & locked', 2600)
    if (busy) return
    const gName = editing ? (editBatch[0].transporterName || '') : (lockTransporterName || tList.find(t => t.id === veh.transporterId)?.name || '')

    // EDIT MODE — gaadiwala fix (→pending) OR owner/staff edit (stays passed, balance adjusts).
    if (editing) {
      if (ownerEdit && lockedOn(settlements.list, veh.transporterId, veh.date)) return show('This hisab is settled & locked — cannot edit', 2600)
      setBusy(true)
      try {
        const oldTotal = editBatch.reduce((s, r) => s + entryTotal(r), 0)
        const newTotal = drops.reduce((s, dd) => s + entryTotal(dd), 0)
        const delta = ownerEdit ? (newTotal - oldTotal) : 0 // gaadiwala resubmit → pending, no balance change
        const newStatus = ownerEdit ? 'passed' : 'pending'
        const batchChallan = editBatch[0].challanNo || 0
        // Build the whole edit (changed drops + removed drops + added drops) and
        // commit it in ONE atomic transaction (P1.3) — never half-apply an edit.
        const updates = [], inserts = [], softDeletes = []
        const n = Math.max(drops.length, editBatch.length)
        for (let i = 0; i < n; i++) {
          const d = drops[i]; const row = editBatch[i]
          if (row && d) {
            const patch = { date: veh.date, gaadiNumber: veh.gaadiNumber.trim(), ...rowFields(d), status: newStatus }
            if (!ownerEdit) patch.correctionReason = ''
            updates.push({ id: row.id, expectedRevision: row.revision, patch })
          } else if (row && !d) {
            softDeletes.push(row.id)
          } else if (!row && d) {
            inserts.push({ id: makeId('r'), date: veh.date, status: newStatus, revision: 0, challanNo: ownerEdit ? batchChallan : 0, submittedBy: by || '', transporterName: gName, transporterId: veh.transporterId, gaadiNumber: veh.gaadiNumber.trim(), ...rowFields(d), batchId: editBatch[0].batchId, createdByUser: by || '', sourceApp: 'transportfreight', workflowStage: 'transport', factoryId: 'main', deleted: false })
          }
        }
        const balance = delta ? { transporterId: veh.transporterId, delta, level: balanceHint(transporters, veh.transporterId, delta).level } : null
        // Phone-first: the edit is saved to the outbox and applied (revision-guarded)
        // when online. If it can't apply because the chakkar changed elsewhere, res.stale
        // is set (immediate) or the pending banner flags it later — never silent.
        const item = {
          id: makeId('edit'), kind: 'edit', by, level, ownerEdit,
          transporterId: veh.transporterId, transporterName: gName, date: veh.date,
          challanNo: batchChallan, batchId: editBatch[0].batchId, spec: { updates, inserts, softDeletes, balance }, grand: newTotal,
          createdAt: new Date().toISOString(),
        }
        const res = await outbox.save(item)
        if (res.stale) { show('This chakkar was changed elsewhere — reopen and redo the edit', 3200); return }
        if (ownerEdit) {
          log('entry.edit', `${fmtChallan(batchChallan)} ${fmtDate(veh.date)} Δ₹${delta}`, by, editBatch[0].batchId)
          logs.insert(auditLine('entry.edit', { by, role: level, before: { total: oldTotal }, after: { total: newTotal }, device: navigator.userAgent }))
        } else {
          log('entry.resubmit', `${gName} ${fmtDate(veh.date)}`, by, editBatch[0].batchId)
          logs.insert(auditLine('entry.resubmit', { by, role: level, after: { batchId: editBatch[0].batchId }, device: navigator.userAgent }))
        }
        show(res.uploaded ? (ownerEdit ? 'Entry updated ✓' : 'Resubmitted for approval ✓') : 'Saved on your phone ✓ — will apply when online', 2600)
        onDone && onDone()
      } catch { show('Could not save — check internet and try again', 2600) } finally { setBusy(false) }
      return
    }

    // NEW — gaadiwala pending submission OR staff direct-passed entry.
    // Dup-check also scans the outbox so a chakkar saved-on-phone-but-not-yet-
    // uploaded still trips the "possible duplicate?" confirm (no re-entry doubling).
    const dup = findDuplicate([...entries.list, ...outboxEntryRows()], { transporterId: veh.transporterId, gaadiNumber: veh.gaadiNumber.trim(), date: veh.date, ...drops[0], destinationId: drops[0].destinationId })
    if (dup && !window.confirm(`Possible duplicate of ${dup.challanNo ? fmtChallan(dup.challanNo) : 'a recent trip'} (same gaadi, date, amount). Save anyway?`)) return
    setBusy(true)
    try {
      const bId = makeId('batch')
      let grand = 0
      // Build all drop rows with FIXED ids (challan filled in at upload time). The
      // chakkar is saved to the phone first via the outbox, then uploaded in ONE
      // idempotent transaction — never lost, never double-counted on retry.
      const inserts = drops.map((d) => {
        const rec = {
          id: makeId('r'),
          date: veh.date, challanNo: 0, status: pendingMode ? 'pending' : 'passed', revision: 0,
          submittedBy: by || '', transporterName: gName, transporterId: veh.transporterId,
          gaadiNumber: veh.gaadiNumber.trim(), ...rowFields(d),
          batchId: bId, createdByRole: level || '', createdByUser: by || '',
          sourceApp: 'transportfreight', workflowStage: 'transport', factoryId: 'main', deleted: false,
        }
        grand += entryTotal(rec)
        return rec
      })
      // A passed (staff/owner) entry moves the balance in the SAME txn (P1-2);
      // a pending (gaadiwala) submission doesn't touch the balance until passed.
      const bh = pendingMode ? null : balanceHint(transporters, veh.transporterId, +grand)
      const item = {
        id: bId, kind: pendingMode ? 'pending' : 'new', by, level,
        transporterId: veh.transporterId, transporterName: gName, gaadiNumber: veh.gaadiNumber.trim(),
        date: veh.date, inserts, grand,
        balance: bh ? { transporterId: veh.transporterId, delta: +grand, level: bh.level } : null,
        createdAt: new Date().toISOString(),
      }
      const res = await outbox.save(item)
      const n = drops.length
      lastUsed.set({ ...(lastUsed.get() || {}), gaadiNumber: veh.gaadiNumber })
      if (pendingMode) {
        log('entry.submit', `${gName} ${fmtDate(veh.date)} ₹${grand} · ${n} drop${n > 1 ? 's' : ''}`, by, bId)
        logs.insert(auditLine('entry.submit', { by, role: level, after: { total: grand, drops: n }, device: navigator.userAgent }))
        setVeh({ date: veh.date, transporterId: lockTransporterId || '', gaadiNumber: '' })
        setDrops([emptyDrop()])
        show(res.uploaded ? `Sent for approval ✓ · ${n} drop${n > 1 ? 's' : ''}` : 'Saved on your phone ✓ — will upload when online', 3000)
      } else {
        log('entry.add', `${res.challanNo ? fmtChallan(res.challanNo) : '(pending upload)'} ${fmtDate(veh.date)} ₹${grand} · ${n} drop${n > 1 ? 's' : ''}`, by, bId)
        logs.insert(auditLine('entry.add', { by, role: level, after: { challanNo: res.challanNo || 0, total: grand, drops: n }, device: navigator.userAgent }))
        setVeh({ date: veh.date, transporterId: '', gaadiNumber: '' })
        setDrops([emptyDrop()])
        show(res.uploaded ? `Saved ${fmtChallan(res.challanNo)} · ${n} drop${n > 1 ? 's' : ''} ✓` : 'Saved on your phone ✓ — will upload when online', 3000)
      }
    } catch { show('Could not save — check internet and try again', 2600) } finally { setBusy(false) }
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4 pb-40">
      <Toast msg={msg} />

      {/* Vehicle-level: date, transporter, gaadi */}
      <Card className="p-4 space-y-4">
        {pendingMode || editing ? (
          <div className="flex items-center justify-between bg-indigo-600 text-white rounded-2xl px-4 py-3">
            <span className="text-xs uppercase tracking-wide text-indigo-200 font-bold">{editing ? (ownerEdit ? 'Edit trip' : 'Editing chakkar') : 'New trip'}</span>
            <span className="text-sm font-bold font-mono">{ownerEdit ? fmtChallan(editBatch[0].challanNo) : 'Sent for approval'}</span>
          </div>
        ) : (
          <div className="flex items-center justify-between bg-slate-800 text-white rounded-2xl px-4 py-3">
            <span className="text-xs uppercase tracking-wide text-slate-300 font-bold">Challan No</span>
            <span className="text-lg font-bold font-mono">{fmtChallan(challanNo)}</span>
          </div>
        )}
        <div>
          <FieldLabel>Date</FieldLabel>
          <div className="mt-1.5"><DateInput value={veh.date} onChange={e => setVehField('date')(e.target.value)} /></div>
          <p className="text-[11px] text-slate-400 mt-1">{fmtDate(veh.date)}</p>
        </div>

        <div>
          <FieldLabel>Gaadiwala</FieldLabel>
          <div className="mt-1.5">
            {lockTransporterId ? (
              <div className="w-full border-2 border-slate-200 bg-slate-50 rounded-2xl px-4 py-4 text-base font-semibold text-slate-700">{lockTransporterName || '—'}</div>
            ) : (
              <Combobox options={tItems} value={veh.transporterId} placeholder="Type to search gaadiwala…" addLabel="Add gaadiwala" onSelect={setVehField('transporterId')} onAddNew={addTransporter} />
            )}
          </div>
        </div>

        <div>
          <FieldLabel>Gaadi No (last 4 digits)</FieldLabel>
          <div className="mt-1.5"><TextInput value={veh.gaadiNumber} inputMode="numeric" maxLength={4} placeholder="e.g. 1234" onChange={setGaadi} /></div>
        </div>
      </Card>

      {/* One block per transport office (drop) */}
      {drops.map((d, i) => (
        <Card key={i} className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <FieldLabel>{i === 0 ? 'Transport (1st drop)' : `Extra point ${i} — transport`}</FieldLabel>
            {i > 0 && <button onClick={() => removeDrop(i)} className="text-xs font-bold text-red-600 bg-red-50 rounded-lg px-3 py-1.5">✕ Remove</button>}
          </div>

          <div>
            <Combobox options={dItems} value={d.destinationId} placeholder="Type to search transport…" addLabel="Add transport" onSelect={setDropField(i, 'destinationId')} onAddNew={(name) => addDestination(i, name)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><FieldLabel>Bags</FieldLabel><div className="mt-1.5"><NumberInput value={d.bags} placeholder="0" onChange={e => setDropField(i, 'bags')(e.target.value)} /></div></div>
            <div><FieldLabel>Pvt Marka</FieldLabel><div className="mt-1.5"><TextInput value={d.pvtMarka} placeholder="marka" onChange={e => setDropField(i, 'pvtMarka')(e.target.value)} /></div></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-xs font-semibold text-slate-500">Freight</span><NumberInput value={d.freight} placeholder="0" onChange={e => setDropField(i, 'freight')(e.target.value)} /></div>
            <div><span className="text-xs font-semibold text-slate-500">Bilti Charge</span><NumberInput value={d.lrCharge} placeholder="0" onChange={e => setDropField(i, 'lrCharge')(e.target.value)} /></div>
            <div><span className="text-xs font-semibold text-slate-500">Labour</span><NumberInput value={d.unloading} placeholder="0" onChange={e => setDropField(i, 'unloading')(e.target.value)} /></div>
            <div><span className="text-xs font-semibold text-slate-500">Misc</span><NumberInput value={d.misc} placeholder="0" onChange={e => setDropField(i, 'misc')(e.target.value)} /></div>
          </div>

          {i > 0 && (
            <div>
              <span className="text-xs font-semibold text-slate-500">Extra Point</span>
              <NumberInput value={d.extraPoint} placeholder="0" onChange={e => setDropField(i, 'extraPoint')(e.target.value)} />
              <p className="text-[11px] text-slate-400 mt-1">{EXTRA_POINT_HINT}</p>
            </div>
          )}

          <div><span className="text-xs font-semibold text-slate-500">Remarks</span><TextInput value={d.remarks} placeholder="optional" onChange={e => setDropField(i, 'remarks')(e.target.value)} /></div>

          <div className="text-right text-sm text-slate-500">Drop total <span className="font-bold text-slate-800 font-mono">₹{fmtNum(entryTotal(d))}</span></div>
        </Card>
      ))}

      <button onClick={addDrop} className="w-full border-2 border-dashed border-blue-300 text-blue-700 font-bold rounded-2xl py-4 bg-blue-50/50 active:bg-blue-100">
        ➕ Add another transport (extra point)
      </button>

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 p-3 z-20" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="flex-1">
            <div className="text-xs text-slate-500">Total · {drops.length} drop{drops.length > 1 ? 's' : ''}</div>
            <div className="text-2xl font-bold text-slate-800 font-mono">₹{fmtNum(grandTotal)}</div>
          </div>
          {editing && <Button size="lg" variant="neutral" onClick={() => onDone && onDone()} disabled={busy}>Cancel</Button>}
          <Button size="lg" variant="success" onClick={save} disabled={busy} className="px-6">{busy ? 'Saving…' : (pendingMode ? 'Submit' : editing ? (ownerEdit ? 'Save' : 'Resubmit') : 'Save')}</Button>
        </div>
      </div>
    </div>
  )
}
