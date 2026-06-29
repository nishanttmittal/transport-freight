/**
 * Button — single source of truth for tappable actions.
 * Large touch targets by default (factory / mobile use). Variants keep colors
 * consistent across every module.
 */
const VARIANTS = {
  primary:  'bg-blue-600 text-white shadow-lg shadow-blue-300 active:bg-blue-700',
  success:  'bg-emerald-600 text-white shadow-lg shadow-emerald-300 active:bg-emerald-700',
  danger:   'bg-red-600 text-white shadow-lg shadow-red-200 active:bg-red-700',
  neutral:  'bg-white text-slate-600 border-2 border-slate-200 active:bg-slate-50',
  ghost:    'bg-slate-100 text-slate-700 active:bg-slate-200',
}

const SIZES = {
  sm: 'px-4 py-2 text-sm rounded-xl',
  md: 'px-5 py-3 text-base rounded-2xl',
  lg: 'px-6 py-5 text-lg rounded-2xl',
}

export default function Button({
  variant = 'primary', size = 'md', disabled, className = '', children, ...props
}) {
  const base = 'font-bold transition-all active:scale-95 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:active:scale-100'
  return (
    <button
      disabled={disabled}
      className={`${base} ${SIZES[size]} ${disabled ? '' : VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
