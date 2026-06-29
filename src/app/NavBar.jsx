/**
 * Top navigation bar shown inside a module page; "Home" returns to the grid.
 * Uses safe-area top padding so the Home button sits BELOW the iPhone status/
 * signal area and stays tappable. A bigger tap target than before.
 */
export default function NavBar({ title, onHome }) {
  return (
    <header className="bg-slate-800 text-white px-4 flex items-center gap-3 shadow-lg no-print" style={{ paddingTop: 'calc(0.7rem + env(safe-area-inset-top))', paddingBottom: '0.7rem' }}>
      <button onClick={onHome} className="flex items-center gap-1.5 text-slate-200 hover:text-white text-sm font-semibold bg-white/10 rounded-lg px-3 py-1.5 active:scale-95">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
        Home
      </button>
      <h1 className="text-base font-semibold truncate">{title}</h1>
    </header>
  )
}
