
export default function FiltroPeriodo({ desde, hasta, onChange, onAplicar, disabled = false }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white border border-slate-200 p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-desde" className="text-xs font-medium text-slate-500">
          Desde
        </label>
        <input
          id="filtro-desde"
          type="date"
          required
          value={desde}
          disabled={disabled}
          onChange={(e) => onChange({ desde: e.target.value, hasta })}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-hasta" className="text-xs font-medium text-slate-500">
          Hasta
        </label>
        <input
          id="filtro-hasta"
          type="date"
          required
          value={hasta}
          disabled={disabled}
          onChange={(e) => onChange({ desde, hasta: e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
      </div>
      <button
        type="button"
        onClick={onAplicar}
        disabled={disabled}
        className="min-h-11 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-brand-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {disabled ? 'Cargando…' : 'Aplicar'}
      </button>
    </div>
  )
}
