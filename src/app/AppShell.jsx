/**
 * AppShell — 3-tier access for the Welder app:
 *   • Staff (welder): ?welder=1&who=Name → entry only (data entry, status pending).
 *   • Manager: ?role=manager (or chooser) → review & PASS entries; no edit/create/delete.
 *   • Owner: ?role=owner (or chooser) → approve + full + dashboard + history + admin.
 * iPhone fix: the Switch button lives in a BOTTOM bar (not under the status/signal
 * area at the top), and top bars use safe-area padding so their controls are reachable.
 */
import { useState } from 'react'
import { getModule } from '../modules/registry'
import { isFirebaseConfigured } from '../core/db/firebaseConfig'
import ModuleHome from './ModuleHome'
import NavBar from './NavBar'
import RoleChooser from './RoleChooser'
import AuthGate from './AuthGate'

const ROLE_KEY = 'wld:role'
const STAFF_KEY = 'wld:staff' // remembers this device is a welder ENTRY phone
const WHO_KEY = 'wld:who'     // remembers which welder, for attribution

/** Bottom-fixed bar — reachable on phones, away from the top status area. */
function BottomBar({ label, onSwitch, switchLabel = 'Switch' }) {
  return (
    <div className="fixed bottom-0 inset-x-0 bg-slate-900 text-slate-300 px-4 flex items-center justify-between text-xs no-print z-30"
      style={{ paddingTop: '0.6rem', paddingBottom: 'calc(0.6rem + env(safe-area-inset-bottom))' }}>
      <span className="font-semibold tracking-wide uppercase truncate">{label}</span>
      {onSwitch && <button onClick={onSwitch} className="flex items-center gap-1 bg-white/15 rounded-lg px-3 py-1.5 font-bold flex-shrink-0">⇄ {switchLabel}</button>}
    </div>
  )
}

function StaffView({ module, operator, onSwitch }) {
  const floorPages = module.pages.filter(p => p.floor)
  const [activeKey, setActiveKey] = useState(module.floorPageKey || floorPages[0]?.key)
  const page = floorPages.find(p => p.key === activeKey) || floorPages[0]
  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <header className="bg-gradient-to-r from-amber-600 to-amber-700 text-white px-5 no-print" style={{ paddingTop: 'calc(0.9rem + env(safe-area-inset-top))', paddingBottom: '0.9rem' }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="w-9 h-9 bg-white/15 rounded-xl flex items-center justify-center text-lg">{module.icon}</div>
          <div><div className="font-bold leading-tight">{module.title}</div><div className="text-white/80 text-xs">{page.title}{operator ? ` · ${operator}` : ''}</div></div>
        </div>
      </header>
      <page.Component floor operator={operator} />
      {/* Floor tabs (Add / Dispatch) sit just above the bottom bar — reachable. */}
      {floorPages.length > 1 && (
        <div className="fixed inset-x-0 z-30 bg-white border-t border-slate-200 flex no-print" style={{ bottom: 'calc(2.4rem + env(safe-area-inset-bottom))' }}>
          {floorPages.map(p => (
            <button key={p.key} onClick={() => setActiveKey(p.key)}
              className={`flex-1 py-2.5 text-sm font-bold ${activeKey === p.key ? 'text-amber-600 border-t-2 border-amber-500 -mt-px' : 'text-slate-400'}`}>
              {p.icon} {p.floorTab || p.title}
            </button>
          ))}
        </div>
      )}
      {onSwitch && <BottomBar label={`Welder${operator ? ' · ' + operator : ''}`} onSwitch={onSwitch} />}
    </div>
  )
}

function Console({ module, level, onSwitch, userEmail }) {
  const [activeKey, setActiveKey] = useState(null)
  const owner = level === 'owner'
  const by = owner ? 'Owner' : (module.inchargeLabel || 'User1')
  const pages = module.pages.filter(p => (p.roles || []).includes(level))
  const view = { ...module, pages }
  const activePage = pages.find(p => p.key === activeKey)
  const roleLabel = owner ? 'Owner' : (module.inchargeLabel || 'In-Charge')
  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {activePage ? (
        <>
          <NavBar title={activePage.title} onHome={() => setActiveKey(null)} />
          <activePage.Component level={level} owner={owner} by={by} />
        </>
      ) : (
        <ModuleHome module={view} onOpen={setActiveKey} />
      )}
      <BottomBar label={userEmail ? `${roleLabel} · ${userEmail}` : roleLabel} onSwitch={onSwitch} switchLabel={userEmail ? 'Sign out' : 'Switch'} />
    </div>
  )
}

export default function AppShell({ moduleId }) {
  const module = getModule(moduleId)
  const { Provider } = module
  const [role, setRole] = useState(() => localStorage.getItem(ROLE_KEY))
  const pick = (r) => { localStorage.setItem(ROLE_KEY, r); setRole(r) }
  const reset = () => { localStorage.removeItem(ROLE_KEY); setRole(null) }

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const roleParam = params && params.get('role') // 'user1' | 'owner' (dedicated links)
  const normParam = roleParam === 'user1' ? 'incharge' : roleParam
  const wantsExit = !!(params && (roleParam || params.has('exit'))) // owner/manager link → leave welder mode

  // Remember welder ENTRY mode on this device. The home-screen PWA icon opens the
  // manifest start_url (/welder/) WITHOUT ?welder=1, which would otherwise drop the
  // worker into the Manager/Owner login. Persisting it once (from their ?welder=1
  // link) keeps the icon landing on the entry screen. An owner/manager link
  // (?role=… or ?exit=1) clears it so the phone can escape welder mode.
  if (params && typeof localStorage !== 'undefined') {
    if (params.has('welder') || params.has('floor')) {
      localStorage.setItem(STAFF_KEY, '1')
      const w = params.get('who') || ''
      if (w) localStorage.setItem(WHO_KEY, w)
    } else if (wantsExit) {
      localStorage.removeItem(STAFF_KEY)
      localStorage.removeItem(WHO_KEY)
    }
  }

  const who = (params && params.get('who')) ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem(WHO_KEY) : '') || ''

  // CLOUD MODE: real authentication for EVERYONE (welders included — the old
  // anonymous ?welder=1 entry is removed; it was the data leak). Role decides the
  // view: staff → entry-only StaffView; manager/owner → full Console.
  if (isFirebaseConfigured) {
    return (
      <Provider>
        <AuthGate title={module.title} icon={module.icon}>
          {({ role, email, name, signOut }) =>
            role === 'staff'
              ? <StaffView module={module} operator={name || who} onSwitch={signOut} />
              : <Console module={module} level={role === 'owner' ? 'owner' : 'incharge'} onSwitch={signOut} userEmail={email} />
          }
        </AuthGate>
      </Provider>
    )
  }

  // LOCAL / OFFLINE MODE (?local=1): no-password role chooser, for OFFLINE TESTING
  // ONLY (no cloud data). Production always runs the Google AuthGate branch above.
  const effective = normParam === 'incharge' || normParam === 'owner' ? normParam : role
  return (
    <Provider>
      {!effective && <RoleChooser title={module.title} icon={module.icon} inchargeLabel={module.inchargeLabel} onPick={pick} />}
      {effective === 'incharge' && <Console module={module} level="incharge" onSwitch={roleParam ? null : reset} />}
      {effective === 'owner' && <Console module={module} level="owner" onSwitch={roleParam ? null : reset} />}
    </Provider>
  )
}
