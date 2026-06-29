/**
 * useToast — tiny transient-message hook + Toast component. Reusable feedback
 * ("Saved!", "Deleted 3 entries") for any module.
 */
import { useState, useCallback } from 'react'

export function useToast() {
  const [msg, setMsg] = useState('')
  const show = useCallback((m, ms = 2500) => {
    setMsg(m)
    setTimeout(() => setMsg(''), ms)
  }, [])
  return { msg, show }
}

export function Toast({ msg, tone = 'success' }) {
  if (!msg) return null
  const tones = {
    success: 'bg-emerald-500',
    error: 'bg-red-500',
    info: 'bg-slate-800',
  }
  return (
    <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 ${tones[tone]} text-white rounded-2xl px-6 py-4 shadow-2xl font-bold text-base`}>
      {msg}
    </div>
  )
}
