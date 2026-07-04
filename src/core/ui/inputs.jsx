/**
 * Input primitives — shared styling for every form control so the whole app
 * looks consistent and stays touch-friendly. One place to restyle all inputs.
 */
import { useState, useRef, useEffect } from 'react'

const FIELD = 'w-full border-2 border-slate-300 rounded-2xl px-4 py-4 text-base font-semibold ' +
  'focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500 bg-white appearance-none'

export function TextInput({ className = '', ...props }) {
  return <input type="text" className={`${FIELD} ${className}`} {...props} />
}

export function NumberInput({ className = '', ...props }) {
  return <input type="number" inputMode="numeric" className={`${FIELD} ${className}`} {...props} />
}

export function DateInput({ className = '', ...props }) {
  return <input type="date" className={`${FIELD} ${className}`} {...props} />
}

export function Select({ options = [], className = '', ...props }) {
  return (
    <select className={`${FIELD} ${className}`} {...props}>
      {options.map(o => {
        const value = typeof o === 'string' ? o : o.value
        const label = typeof o === 'string' ? o : o.label
        return <option key={value} value={value}>{label}</option>
      })}
    </select>
  )
}

/**
 * Combobox — type-to-search picker for a long option list, phone-friendly.
 * Closed: a big button showing the current selection (or placeholder). Tap it to
 * open a search box; type 2–3 letters and the list narrows (matches anywhere in
 * the name, case-insensitive). Tap a row to pick.
 *
 * Props:
 *   options  : [{ value, label }]   the real choices (no placeholder/add rows)
 *   value    : currently selected value (controlled)
 *   onSelect : (value) => void      fired when a row is tapped
 *   onAddNew : (typedText) => void  optional — when set, a "＋ Add ‘xyz’" row
 *              appears if the typed text matches nothing; tapping it calls this
 *              (used to add-a-master-and-pick-it in one tap)
 *   placeholder, addLabel, disabled
 */
export function Combobox({ options = [], value = '', onSelect, onAddNew, placeholder = 'Type to search…', addLabel = 'Add', disabled = false, className = '' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef(null)
  const selected = options.find(o => o.value === value)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setQ('') } }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close) }
  }, [open])

  const qq = q.trim().toLowerCase()
  const filtered = qq ? options.filter(o => (o.label || '').toLowerCase().includes(qq)) : options
  const exact = options.some(o => (o.label || '').trim().toLowerCase() === qq)
  const showAdd = onAddNew && qq && !exact

  const pick = (v) => { onSelect && onSelect(v); setOpen(false); setQ('') }
  const add = () => { onAddNew && onAddNew(q.trim()); setOpen(false); setQ('') }

  return (
    <div className={`relative ${className}`} ref={boxRef}>
      {open ? (
        <input autoFocus type="search" inputMode="search" value={q} placeholder={placeholder}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (filtered.length) pick(filtered[0].value); else if (showAdd) add() } if (e.key === 'Escape') { setOpen(false); setQ('') } }}
          className={FIELD} />
      ) : (
        <button type="button" disabled={disabled} onClick={() => !disabled && setOpen(true)}
          className={`${FIELD} text-left flex items-center justify-between ${disabled ? 'opacity-60' : ''}`}>
          <span className={`truncate ${selected ? 'text-slate-800' : 'text-slate-400 font-normal'}`}>{selected ? selected.label : placeholder}</span>
          <span className="text-slate-400 flex-shrink-0 ml-2">▾</span>
        </button>
      )}
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border-2 border-slate-200 rounded-2xl shadow-xl max-h-72 overflow-auto">
          {showAdd && (
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={add}
              className="w-full text-left px-4 py-3.5 font-bold text-blue-700 bg-blue-50/60 active:bg-blue-100 border-b border-slate-100">
              ＋ {addLabel} “{q.trim()}”
            </button>
          )}
          {filtered.map(o => (
            <button key={o.value} type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(o.value)}
              className={`w-full text-left px-4 py-3.5 text-base border-b border-slate-50 last:border-0 active:bg-slate-100 ${o.value === value ? 'font-bold text-blue-700 bg-blue-50/40' : 'text-slate-700'}`}>
              {o.label}
            </button>
          ))}
          {filtered.length === 0 && !showAdd && (
            <div className="px-4 py-5 text-slate-400 text-sm text-center">No matches</div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * NumberStepper — big −/＋ control with optional quick-add chips. Built for
 * fast factory data entry on a phone.
 */
export function NumberStepper({ value, onChange, quickAdds = [] }) {
  const n = Number(value) || 0
  return (
    <div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onChange(String(Math.max(0, n - 1)))}
          className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-700 text-3xl font-bold active:bg-slate-200 flex-shrink-0">−</button>
        <input type="number" inputMode="numeric" value={value} placeholder="0"
          onChange={e => onChange(e.target.value)}
          className="flex-1 border-2 border-slate-300 rounded-2xl px-4 py-4 text-3xl font-bold text-center font-mono focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500 w-full min-w-0" />
        <button type="button" onClick={() => onChange(String(n + 1))}
          className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-700 text-3xl font-bold active:bg-slate-200 flex-shrink-0">+</button>
      </div>
      {quickAdds.length > 0 && (
        <div className="grid grid-cols-6 gap-1.5 mt-2.5">
          {quickAdds.map(q => (
            <button key={q} type="button" onClick={() => onChange(String(n + q))}
              className="py-2.5 rounded-xl bg-blue-50 text-blue-700 font-bold text-sm active:bg-blue-100">+{q}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/** SearchBar — labelled search input with icon. */
export function SearchBar({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="relative">
      <svg className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input type="search" value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full border-2 border-slate-200 rounded-xl pl-10 pr-3 py-3 text-base focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500" />
    </div>
  )
}
