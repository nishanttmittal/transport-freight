/** Card — standard white surface used throughout the app. */
export default function Card({ className = '', children, ...props }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm ${className}`} {...props}>
      {children}
    </div>
  )
}

/** Small uppercase section label, used above fields. */
export function FieldLabel({ children, className = '' }) {
  return (
    <span className={`text-sm font-bold text-slate-500 uppercase tracking-wide ${className}`}>
      {children}
    </span>
  )
}
