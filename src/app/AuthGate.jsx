/**
 * AuthGate — real authentication for the Staff/Owner console (cloud mode).
 *
 * Flow: the Firestore provider has already signed the device in ANONYMOUSLY for
 * sync. Here we require a Google sign-in, then resolve the role from the in-app
 * users list (apps/transportfreight/users) plus the bootstrap OWNER_EMAILS.
 * Children are rendered only when a valid role is found.
 */
import { useEffect, useState } from 'react'
import { signInWithGoogle, signOutUser, watchAuth } from '../core/db/firebase'
import { useFreight } from '../modules/freight/FreightContext'
import { OWNER_EMAILS } from '../modules/freight/config'

/** Resolve 'owner' | 'manager' | 'staff' | null for an email against the users list.
 *  Phase 1 uses owner + manager only (manager = office staff who enter freight). */
export function resolveRole(email, users) {
  if (!email) return null
  const e = email.toLowerCase()
  if (OWNER_EMAILS.map(x => x.toLowerCase()).includes(e)) return 'owner'
  const u = (users || []).find(u => (u.email || '').toLowerCase() === e && u.active !== false)
  if (!u) return null
  if (u.role === 'owner') return 'owner'
  if (u.role === 'staff' || u.role === 'employee' || u.role === 'welder') return 'staff'
  return 'manager'
}

/** Display name for the signed-in user (floor attribution). */
export function resolveName(email, users) {
  const u = (users || []).find(u => (u.email || '').toLowerCase() === (email || '').toLowerCase())
  return (u && u.name) || (email ? email.split('@')[0] : '')
}

function Screen({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center p-6 text-white text-center"
      style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}>{children}</div>
  )
}

export default function AuthGate({ title = 'UNICO', icon = '🚚', children }) {
  const { users } = useFreight()
  const [user, setUser] = useState(undefined) // undefined = still loading
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => watchAuth(setUser), [])

  const email = user && !user.isAnonymous ? (user.email || '') : ''
  const role = resolveRole(email, users.list)

  const doSignIn = async () => {
    setBusy(true); setErr('')
    try { await signInWithGoogle() } catch (e) { setErr(e?.message || 'Sign-in failed') } finally { setBusy(false) }
  }
  const doSignOut = () => signOutUser()

  if (user === undefined) {
    return <Screen><div className="text-2xl">🔐</div><div className="text-sm text-slate-300 mt-2">Checking sign-in…</div></Screen>
  }

  // Signed in with Google AND has a role → render the console.
  if (email && role) return children({ role, email, name: resolveName(email, users.list), signOut: doSignOut })

  // Signed in with Google but NOT authorised.
  if (email && !role) {
    return (
      <Screen>
        <div className="text-4xl mb-3">🚫</div>
        <h1 className="text-xl font-bold">No access</h1>
        <p className="text-slate-400 text-sm mt-2 max-w-xs">{email} is not authorised. Ask the owner to add you in Admin → Users &amp; Access.</p>
        <button onClick={doSignOut} className="mt-6 bg-white/15 rounded-xl px-5 py-2.5 font-bold text-sm">Use a different account</button>
      </Screen>
    )
  }

  // Not signed in with Google (anonymous baseline) → sign-in screen.
  return (
    <Screen>
      <div className="text-5xl mb-3">{icon}</div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-slate-400 text-sm mt-1 mb-8">Sign in to continue</p>
      <button onClick={doSignIn} disabled={busy}
        className="w-full max-w-xs bg-white text-slate-800 rounded-2xl px-6 py-4 font-bold shadow-xl active:scale-95 transition-transform disabled:opacity-60 flex items-center justify-center gap-3">
        <span className="text-lg">🟦</span>{busy ? 'Opening…' : 'Sign in with Google'}
      </button>
      {err && <p className="text-red-300 text-xs mt-4 max-w-xs">{err}</p>}
    </Screen>
  )
}
