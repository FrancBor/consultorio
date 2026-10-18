const STATUS = {
  atendida: { label: 'Atendida', style: 'bg-brand-50 text-brand-700' },
  inasistencia: { label: 'Inasistencia', style: 'bg-critical-100 text-critical-600' },
  agendada: { label: 'Agendada', style: 'bg-slate-100 text-slate-700' },
  confirmada: { label: 'Confirmada', style: 'bg-warn-100 text-warn-600' },
  cancelada: { label: 'Cancelada', style: 'bg-slate-200 text-slate-700' },
}

export default function TablaDetalle({ rows, meta, loading = false, onPageChange }) {
  const page = meta?.page ?? 1
  const totalPages = meta?.totalPages ?? 0

  return (
    <div className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden" aria-busy={loading}>
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-700">Detalle de atenciones</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          {meta ? `${meta.total.toLocaleString('es-CL')} registros en el período seleccionado` : 'Registros dentro del período seleccionado'}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="px-5 py-2 font-medium">Fecha</th>
              <th className="px-5 py-2 font-medium">Hora</th>
              <th className="px-5 py-2 font-medium">Tipo de atención</th>
              <th className="px-5 py-2 font-medium">Estado</th>
              <th className="px-5 py-2 font-medium">Tiempo de espera</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                  No hay atenciones para mostrar.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const status = STATUS[row.estado] ?? {
                label: row.estado,
                style: 'bg-slate-100 text-slate-700',
              }
              return <tr key={row.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5 text-slate-700 tabular-nums">{row.fecha}</td>
                <td className="px-5 py-2.5 text-slate-700 tabular-nums">{row.hora_agendada}</td>
                <td className="px-5 py-2.5 text-slate-700">{row.tipo_atencion}</td>
                <td className="px-5 py-2.5">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${status.style}`}
                  >
                    {status.label}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-slate-700 tabular-nums">
                  {row.tiempo_espera_minutos != null ? `${row.tiempo_espera_minutos} min` : '—'}
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
          <span>Página {page} de {totalPages}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={loading || page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-medium transition-colors duration-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={loading || page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-medium transition-colors duration-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
