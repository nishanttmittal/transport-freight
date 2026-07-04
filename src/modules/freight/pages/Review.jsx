/**
 * Review — the approval home for Nishant / Anshul. Two sections:
 *  1) Pending review: gaadiwala-submitted chakkars (Stage 2) → Pass / Return / Void.
 *  2) Recent passed chakkars → Cancel (status change, reverses balance).
 * A "chakkar" = all rows sharing a batchId (a vehicle's drops), acted on together.
 */
import { useState } from 'react'
import { Card, Button, useToast, Toast } from '../../../core/ui'
import { fmtNum, fmtDate } from '../../../core/utils/format'
import { useFreight } from '../FreightContext'
import { entryTotal, lockedOn, dropError } from '../logic/calc'
import { applyTransition, STATUS } from '../logic/status'
import { auditLine } from '../logic/audit'
import { balanceHint } from '../logic/balance'
import { fmtChallan } from '../config'

/** Group rows by batchId into chakkar objects. */
function groupBatches(rows) {
  const map = new Map()
  for (const r of rows) {
    const k = r.batchId || r.id
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  return [...map.values()].map(list => ({
    batchId: list[0].batchId || list[0].id,
    rows: list,
    transporterId: list[0].transporterId,
    transporterName: list[0].transporterName,
    gaadiNumber: list[0].gaadiNumber,
    date: list[0].date,
    challanNo: list[0].challanNo,
    status: list[0].status || STATUS.passed,
    total: list.reduce((s, r) => s + entryTotal(r), 0),
  }))
}

export default function Review({ owner = false, by = '', level = '' }) {
  const { transporters, entries, settlements, logs, log, allocateNumber } = useFreight()
  const { msg, show } = useToast()
  const [busy, setBusy] = useState(false)

  const tName = (id, snap) => snap || transporters.list.find(t => t.id === id)?.name || '—'
  const audit = (a) => logs.insert(auditLine(a.action, { ...a, device: navigator.userAgent }))
  const live = (entries.list || []).filter(e => !e.deleted)

  // An entry whose date falls in a finalized (locked) settlement period. Once a
  // hisab is settled, only the owner sees those chakkars in Approvals — for
  // everyone else they drop out of the list (owner keeps them to edit/correct).
  const isSettled = (e) => !!lockedOn(settlements.list, e.transporterId, e.date)

  const pending = groupBatches(live.filter(e => e.status === STATUS.pending || e.status === STATUS.needs_correction))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const passed = groupBatches(live.filter(e => (e.status || STATUS.passed) === STATUS.passed && (owner || !isSettled(e))))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 20)

  // Apply an action to a WHOLE batch in ONE atomic transaction (P1.3) — every
  // row moves together or none does. Revision-guarded, so returns false if any
  // row was changed by someone else in the meantime.
  const applyBatch = async (batch, action, ctx, balance = null) => {
    const updates = batch.rows.map(row => {
      const t = applyTransition(row, action, ctx)
      return { id: row.id, expectedRevision: row.revision, patch: { status: t.status, challanNo: t.challanNo, approvedBy: t.approvedBy || '', approvedAt: t.approvedAt || '', voidReason: t.voidReason || '', correctionReason: t.correctionReason || '', cancelReason: t.cancelReason || '' } }
    })
    const res = await entries.commitBatch({ updates, balance })
    return res.ok
  }

  const doPass = async (batch) => {
    if (busy) return
    // Never pass a chakkar carrying a negative/zero-value drop (P1-3) — it would
    // corrupt the hisab. Send it back for correction instead.
    if (batch.rows.some(r => dropError(r))) return show('This chakkar has an invalid amount — Return it for correction', 3000)
    setBusy(true)
    try {
      const challan = await allocateNumber('challan')
      const bal = { transporterId: batch.transporterId, delta: +batch.total, level: balanceHint(transporters, batch.transporterId, +batch.total).level }
      const ok = await applyBatch(batch, 'pass', { by, role: level, challanNo: challan }, bal)
      if (!ok) return show('Refresh — this was just changed by someone else', 2600)
      log('entry.pass', `${fmtChallan(challan)} ${tName(batch.transporterId, batch.transporterName)} ₹${batch.total}`, by, batch.batchId)
      audit({ action: 'entry.pass', by, role: level, after: { challanNo: challan, total: batch.total } })
      show(`Passed ${fmtChallan(challan)} ✓`)
    } catch { show('Could not save — check internet and try again', 2600) } finally { setBusy(false) }
  }

  const doReasoned = async (batch, action, promptMsg, verb) => {
    const reason = window.prompt(promptMsg)
    if (!reason || !reason.trim()) return show('A reason is required', 2200)
    if (busy) return
    setBusy(true)
    try {
      const bal = action === 'cancel' ? { transporterId: batch.transporterId, delta: -batch.total, level: balanceHint(transporters, batch.transporterId, -batch.total).level } : null
      const ok = await applyBatch(batch, action, { by, role: level, reason: reason.trim() }, bal)
      if (!ok) return show('Refresh — this was just changed by someone else', 2600)
      log(`entry.${action}`, `${tName(batch.transporterId, batch.transporterName)} ₹${batch.total} — ${reason.trim()}`, by, batch.batchId)
      audit({ action: `entry.${action}`, by, role: level, reason: reason.trim(), before: { challanNo: batch.challanNo, total: batch.total } })
      show(`${verb} ✓`)
    } catch { show('Could not save — check internet and try again', 2600) } finally { setBusy(false) }
  }

  const Row = ({ b, children }) => (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">{tName(b.transporterId, b.transporterName)}{b.gaadiNumber ? ` · ${b.gaadiNumber}` : ''}</div>
          <div className="text-xs text-slate-400">{b.challanNo ? fmtChallan(b.challanNo) + ' · ' : ''}{fmtDate(b.date)} · {b.rows.length} drop{b.rows.length > 1 ? 's' : ''}</div>
        </div>
        <div className="text-sm font-bold font-mono text-slate-800">₹{fmtNum(b.total)}</div>
      </div>
      <div className="flex gap-2 mt-2">{children}</div>
    </div>
  )

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      <Toast msg={msg} />

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-bold text-slate-700 text-sm">Pending review ({pending.length})</div>
        {pending.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-sm">Nothing pending. (Gaadiwala submissions arrive here once logins are on.)</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {pending.map(b => (
              <Row key={b.batchId} b={b}>
                <Button size="sm" variant="success" disabled={busy} onClick={() => doPass(b)}>Pass</Button>
                <Button size="sm" variant="neutral" disabled={busy} onClick={() => doReasoned(b, 'return', 'Return to gaadiwala — reason?', 'Returned')}>Return</Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => doReasoned(b, 'void', 'Void this chakkar — reason?', 'Voided')}>Void</Button>
              </Row>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-bold text-slate-700 text-sm">Recent chakkars</div>
        {passed.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-sm">No chakkars yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {passed.map(b => (
              <Row key={b.batchId} b={b}>
                {(owner || level === 'incharge') && <Button size="sm" variant="danger" disabled={busy} onClick={() => doReasoned(b, 'cancel', `Cancel ${fmtChallan(b.challanNo)} — reason?`, 'Cancelled')}>Cancel</Button>}
              </Row>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
