/**
 * Transport Freight Hisab — module manifest. Phase 1: owner + staff (manager)
 * enter freight from the gaadiwala's WhatsApp messages. Per-gaadiwala login is
 * a later phase.
 */
import { FreightProvider, useFreight } from './FreightContext'
import { fmtNum, todayStr } from '../../core/utils/format'
import { INCHARGE_LABEL } from './config'
import Entry from './pages/Entry'
import Dashboard from './pages/Dashboard'
import Hisab from './pages/Hisab'
import Advances from './pages/Advances'
import Masters from './pages/Masters'
import Export from './pages/Export'
import Admin from './pages/Admin'

function HomeStats() {
  const { transporters, entries } = useFreight()
  const today = todayStr()
  const todayCount = (entries.list || []).filter(e => !e.deleted && e.date === today).length
  const tCount = (transporters.list || []).filter(t => !t.deleted).length
  const outstanding = (transporters.list || []).filter(t => !t.deleted).reduce((s, t) => s + (Number(t.runningBalance) || 0), 0)
  const stat = (n, l) => (
    <div className="bg-white/10 rounded-xl px-4 py-2.5 flex-1 text-center">
      <div className="text-2xl font-bold">{n}</div><div className="text-xs text-slate-400 mt-0.5">{l}</div>
    </div>
  )
  return (
    <div className="mt-4 flex gap-3">
      {stat(todayCount, 'Drops Today')}
      {stat(tCount, 'Gaadiwalas')}
      {stat(`₹${fmtNum(outstanding)}`, 'Outstanding')}
    </div>
  )
}

export const freightModule = {
  id: 'freight',
  title: 'Transport Freight Hisab',
  icon: '🚚',
  Provider: FreightProvider,
  HomeStats,
  inchargeLabel: INCHARGE_LABEL,
  floorPageKey: 'entry',
  floorLabel: 'Entry',
  floorIcon: '➕',
  pages: [
    { key: 'entry',     group: 'Daily work', title: 'Record Freight', desc: 'Add a drop: gaadi, transport, charges', icon: '➕', color: 'from-amber-600 to-amber-700', floor: true, roles: ['incharge', 'owner'], Component: Entry },
    { key: 'dashboard', group: 'Daily work', title: 'Dashboard',      desc: 'All gaadiwalas, balances & alerts',     icon: '📊', color: 'from-blue-600 to-blue-700',   roles: ['incharge', 'owner'], Component: Dashboard },
    { key: 'hisab',     group: 'Daily work', title: 'Hisab',          desc: 'One gaadiwala: ledger, settle & PDF',   icon: '💰', color: 'from-emerald-600 to-emerald-700', roles: ['incharge', 'owner'], Component: Hisab },
    { key: 'advances',  group: 'Daily work', title: 'Advances',       desc: 'Record advances paid (Nishant / Anshul)', icon: '💵', color: 'from-rose-600 to-rose-700',   roles: ['incharge', 'owner'], Component: Advances },
    { key: 'masters',   group: 'Daily work', title: 'Gaadiwalas & Transports', desc: 'Manage the dropdown lists',  icon: '🗂️', color: 'from-cyan-600 to-cyan-700',   roles: ['incharge', 'owner'], Component: Masters },
    { key: 'export',    group: 'Owner tools', title: 'Export',        desc: 'Download entries as CSV',                 icon: '📄', color: 'from-violet-600 to-violet-700', roles: ['owner'], Component: Export },
    { key: 'admin',     group: 'Owner tools', title: 'Admin',         desc: 'Users, backup, recalculate balances',     icon: '⚙️', color: 'from-slate-600 to-slate-700',  roles: ['owner'], Component: Admin },
  ],
}
