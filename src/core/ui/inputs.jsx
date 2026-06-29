/**
 * Input primitives — shared styling for every form control so the whole app
 * looks consistent and stays touch-friendly. One place to restyle all inputs.
 */

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
