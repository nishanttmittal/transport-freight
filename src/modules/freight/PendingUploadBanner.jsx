/**
 * Shows when chakkars/advances/reversals/edits are saved on this phone but not yet
 * uploaded. Gives the enterer certainty the data is safe + a one-tap way to tell the
 * owner (a wa.me deep link — no secret shipped in this public app). "Upload now"
 * retries. Also surfaces the rare EDIT that couldn't apply on upload (the chakkar
 * changed under it) so the user redoes it — never silently dropped.
 */
import { useState } from 'react'
import { OWNER_WHATSAPP, fmtChallan } from './config'

const label = (p) => {
  if (p.kind === 'advance') return `Payment ₹${p.amount} → ${p.transporterName}`
  if (p.kind === 'reversal') return `Reverse ₹${p.amount} → ${p.transporterName}`
  if (p.kind === 'edit') return `Edit ${fmtChallan(p.challanNo)} · ${p.transporterName || ''}`.trim()
  return `${p.transporterName || 'Chakkar'} · ${p.date} · ₹${p.grand}`
}

const shortLabel = (p) => {
  if (p.kind === 'advance') return `payment ₹${p.amount} to ${p.transporterName}`
  if (p.kind === 'reversal') return `reversal ₹${p.amount} to ${p.transporterName}`
  if (p.kind === 'edit') return `edit ${fmtChallan(p.challanNo)}`
  return `${p.grand ? '₹' + p.grand : 'chakkar'} ${p.transporterName || ''}`.trim()
}

export default function PendingUploadBanner({ pending = [], onSyncNow, editFailures = [], onDismissFailure, heldItems = [], onDismissHeld }) {
  const [open, setOpen] = useState(false)
  const n = pending.length
  if (!n && !editFailures.length && !heldItems.length) return null
  const summary = pending.map(shortLabel).join(', ')
  const msg = encodeURIComponent(`UNICO Freight: ${n} entry(s) saved on the phone that haven't uploaded yet (no internet / server busy): ${summary}. They'll upload automatically when possible.`)
  const waHref = `https://wa.me/${OWNER_WHATSAPP}?text=${msg}`
  return (
    <div className="fixed top-0 inset-x-0 z-40 shadow-lg" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Failed edits — red, must be acted on (redo the edit) */}
      {editFailures.map(f => (
        <div key={f.id} className="bg-red-600 text-white text-sm px-4 py-2.5 flex items-center gap-3">
          <span className="flex-1">⚠️ An edit to {fmtChallan(f.challanNo)} ({f.transporterName}) couldn’t apply — it was changed elsewhere. Please open it and redo the change.</span>
          <button onClick={() => onDismissFailure && onDismissFailure(f.id)} className="font-bold bg-white/20 rounded-lg px-3 py-1">OK</button>
        </div>
      ))}
      {/* Held by the settled-period lock — needs the owner, never silently dropped (2026-07-19) */}
      {heldItems.map(h => (
        <div key={h.id} className="bg-red-700 text-white text-sm px-4 py-2.5 flex items-center gap-3">
          <span className="flex-1">🔒 A trip saved on the phone ({h.transporterName || 'gaadiwala'}, {h.date}{h.amount ? `, ₹${h.amount}` : ''}) is dated inside an already-SETTLED period, so it was not uploaded. Tell the owner — it must be added to the current hisab instead.</span>
          <button onClick={() => onDismissHeld && onDismissHeld(h.id)} className="font-bold bg-white/20 rounded-lg px-3 py-1">OK</button>
        </div>
      ))}
      {n > 0 && (
        <div className="bg-amber-500 text-amber-950 text-sm">
          <div className="px-4 py-2.5 flex items-center gap-3">
            <button className="flex-1 text-left font-bold" onClick={() => setOpen(o => !o)}>
              ⬆️ {n} saved on phone — not uploaded yet {open ? '▲' : '▼'}
            </button>
            <button onClick={onSyncNow} className="font-bold bg-amber-950/15 rounded-lg px-3 py-1">Upload now</button>
            <a href={waHref} target="_blank" rel="noreferrer" className="font-bold bg-green-600 text-white rounded-lg px-3 py-1">Notify owner</a>
          </div>
          {open && (
            <div className="px-4 pb-2.5 space-y-1">
              {pending.map(p => (
                <div key={p.id} className="text-xs bg-amber-950/10 rounded-lg px-3 py-1.5">{label(p)}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
