/**
 * GaadiwalaView — the whole app as a gaadiwala sees it: submit a new trip (goes
 * to PENDING for staff approval) and view his own hisab. Tabs + Sign out live in
 * the top header so they don't collide with the entry form's bottom Save bar.
 */
import { useState } from 'react'
import Entry from '../modules/freight/pages/Entry'
import GaadiwalaHisab from '../modules/freight/pages/GaadiwalaHisab'
import GaadiwalaChakkarList from '../modules/freight/pages/GaadiwalaChakkarList'

const LOGO = `${import.meta.env.BASE_URL}unico-logo.png`

function Header({ name, onSwitch, tab, setTab, editing }) {
  return (
    <header className="bg-gradient-to-r from-indigo-700 to-indigo-800 text-white no-print" style={{ paddingTop: 'calc(0.8rem + env(safe-area-inset-top))' }}>
      <div className="max-w-lg mx-auto px-4 pb-2 flex items-center gap-3">
        <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center p-1"><img src={LOGO} alt="UNICO" className="max-w-full max-h-full object-contain" /></div>
        <div className="flex-1 min-w-0"><div className="font-bold leading-tight truncate">Transport Freight</div><div className="text-indigo-200 text-xs truncate">{name}</div></div>
        <button onClick={onSwitch} className="text-xs font-bold bg-white/15 rounded-lg px-3 py-1.5">Sign out</button>
      </div>
      {!editing && (
        <div className="max-w-lg mx-auto flex">
          {[['new', '➕ New Trip'], ['hisab', '📋 My Hisab']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2.5 text-sm font-bold ${tab === k ? 'bg-white/15 border-b-2 border-white' : 'text-indigo-200'}`}>{label}</button>
          ))}
        </div>
      )}
    </header>
  )
}

export default function GaadiwalaView({ transporterId, name, onSwitch }) {
  const [tab, setTab] = useState('new')
  const [editBatch, setEditBatch] = useState(null)

  if (!transporterId) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white text-center p-6 gap-3">
        <div className="text-4xl">🚚</div>
        <div className="font-bold">Not linked yet</div>
        <p className="text-slate-300 text-sm max-w-xs">Your login isn’t linked to a gaadiwala yet. Ask the owner to link it in Admin → Users &amp; Access.</p>
        <button onClick={onSwitch} className="mt-3 bg-white/15 rounded-xl px-5 py-2.5 font-bold text-sm">Sign out</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      <Header name={name} onSwitch={onSwitch} tab={tab} setTab={setTab} editing={!!editBatch} />
      {editBatch ? (
        <Entry editBatch={editBatch} lockTransporterId={transporterId} lockTransporterName={name} by={name} onDone={() => setEditBatch(null)} />
      ) : tab === 'new' ? (
        <>
          <Entry pendingMode lockTransporterId={transporterId} lockTransporterName={name} by={name} />
          <GaadiwalaChakkarList transporterId={transporterId} />
        </>
      ) : (
        <GaadiwalaHisab transporterId={transporterId} onEdit={(rows) => { setEditBatch(rows) }} />
      )}
    </div>
  )
}
