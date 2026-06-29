/**
 * ModuleHome — generic landing grid for a module. Renders one card per page
 * declared in the module manifest, plus the module's optional HomeStats.
 * Entirely data-driven: no module-specific code here.
 */
export default function ModuleHome({ module, onOpen }) {
  const { title, pages, HomeStats } = module
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-6 pb-8" style={{ paddingTop: 'calc(2rem + env(safe-area-inset-top))' }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center p-1.5 shadow-sm">
              <img src={`${import.meta.env.BASE_URL}unico-logo.png`} alt="UNICO" className="max-w-full max-h-full object-contain" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{title}</h1>
              <p className="text-slate-400 text-xs mt-0.5">{today}</p>
            </div>
          </div>
          {HomeStats && <HomeStats />}
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-2 mt-2">
        {pages.map((page, i) => (
          <div key={page.key} className="space-y-2">
            {page.group && page.group !== pages[i - 1]?.group && (
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1 pt-3">{page.group}</div>
            )}
            <button onClick={() => onOpen(page.key)}
              className={`w-full bg-gradient-to-r ${page.color} text-white rounded-2xl p-5 flex items-center gap-4 shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-transform text-left`}>
              <div className="text-3xl w-12 h-12 bg-white/15 rounded-xl flex items-center justify-center flex-shrink-0">{page.icon}</div>
              <div>
                <div className="font-bold text-base">{page.title}</div>
                <div className="text-white/75 text-xs mt-0.5">{page.desc}</div>
              </div>
              <svg className="w-5 h-5 text-white/50 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
