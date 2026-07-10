/**
 * Shows when chakkars/advances are saved on this phone but not yet uploaded. Gives
 * the enterer certainty the data is safe + a one-tap way to tell the owner (a
 * wa.me deep link — no secret shipped in this public app). "Upload now" retries.
 */
import { useState } from 'react'
import { OWNER_WHATSAPP } from './config'

export default function PendingUploadBanner({ pending = [], onSyncNow }) {
  const [open, setOpen] = useState(false)
  if (!pending.length) return null
  const n = pending.length
  const summary = pending.map(p => p.kind === 'advance'
    ? `payment ₹${p.amount} to ${p.transporterName}`
    : `${p.grand ? '₹' + p.grand : 'chakkar'} ${p.transporterName || ''}`.trim()).join(', ')
  const msg = encodeURIComponent(`UNICO Freight: ${n} entry(s) saved on the phone that haven't uploaded yet (no internet / server busy): ${summary}. They'll upload automatically when possible.`)
  const waHref = `https://wa.me/${OWNER_WHATSAPP}?text=${msg}`
  return (
    <div className="fixed top-0 inset-x-0 z-40 bg-amber-500 text-amber-950 text-sm shadow-lg"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}>
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
            <div key={p.id} className="text-xs bg-amber-950/10 rounded-lg px-3 py-1.5">
              {p.kind === 'advance'
                ? `Payment ₹${p.amount} → ${p.transporterName}`
                : `${p.transporterName || 'Chakkar'} · ${p.date} · ₹${p.grand}`}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
