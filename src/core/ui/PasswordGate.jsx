/**
 * PasswordGate — reusable access guard. Wrap any subtree to require a password
 * before it renders. Used for the Admin area; reusable for any future
 * protected module/section.
 */
import { useState } from 'react'
import Button from './Button'

export default function PasswordGate({ password, title = 'Access Required', children }) {
  const [pwd, setPwd] = useState('')
  const [granted, setGranted] = useState(false)
  const [error, setError] = useState('')

  if (granted) return children

  // `password` may be a single string or a list of accepted passwords.
  const accepted = Array.isArray(password) ? password : [password]
  const tryUnlock = () => {
    if (accepted.includes(pwd)) setGranted(true)
    else { setError('Incorrect password'); setPwd('') }
  }

  return (
    <div className="flex items-center justify-center min-h-64 p-6">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm border border-slate-200">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl">🔒</div>
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          <p className="text-sm text-slate-500 mt-1">Enter password to continue</p>
        </div>
        <div className="space-y-3">
          <input type="password" value={pwd} autoFocus placeholder="Password"
            onChange={e => { setPwd(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && tryUnlock()}
            className={`w-full border-2 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-4 focus:ring-red-200 ${error ? 'border-red-400' : 'border-slate-300'}`} />
          {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
          <Button variant="primary" className="w-full" onClick={tryUnlock}>Unlock</Button>
        </div>
      </div>
    </div>
  )
}
