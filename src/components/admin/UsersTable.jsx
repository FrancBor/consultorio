const ROLE_BADGE = {
  admin: 'bg-warn-100 text-warn-600',
  consulta: 'bg-brand-50 text-brand-700',
}

function dateLabel(value) {
  if (!value) return 'Sin acceso registrado'
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function UsersTable({
  users,
  meta,
  loading,
  busy,
  currentUserId,
  onSelect,
  onPageChange,
}) {
  function selectUser(user, mode) {
    if (loading || busy) return
    onSelect(user, mode)
  }

  function changePage(page) {
    if (loading || busy) return
    onPageChange(page)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-busy={loading}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Cuentas de acceso al sistema</caption>
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-5 py-3 font-medium">Cuenta</th>
              <th scope="col" className="px-5 py-3 font-medium">Rol</th>
              <th scope="col" className="px-5 py-3 font-medium">Estado</th>
              <th scope="col" className="px-5 py-3 font-medium">Último acceso</th>
              <th scope="col" className="px-5 py-3 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate-600" role="status">
                  Cargando cuentas…
                </td>
              </tr>
            )}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate-600">
                  No hay cuentas que coincidan con los filtros.
                </td>
              </tr>
            )}
            {users.map((user) => {
              const isCurrent = String(user.id) === String(currentUserId)
              return (
                <tr key={user.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">
                      {user.nombre}
                      {isCurrent && <span className="ml-2 text-xs font-normal text-slate-500">(usted)</span>}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-slate-600">{user.usuario}</p>
                    {user.correo && <p className="mt-0.5 text-xs text-slate-500">{user.correo}</p>}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${ROLE_BADGE[user.rol]}`}>
                      {user.rol === 'admin' ? 'Administrador' : 'Consulta'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${user.activo ? 'bg-brand-50 text-brand-700' : 'bg-slate-200 text-slate-700'}`}>
                      {user.activo ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{dateLabel(user.ultimo_acceso_en)}</td>
                  <td className="px-5 py-3">
                    <div className="flex min-w-48 justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => selectUser(user, 'edit')}
                        disabled={loading || busy}
                        className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => selectUser(user, 'password')}
                        disabled={loading || busy}
                        className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                      >
                        Contraseña
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {meta && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
          <span>
            {meta.total.toLocaleString('es-CL')} cuentas · Página {meta.page} de {Math.max(1, meta.totalPages)}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={loading || busy || meta.page <= 1}
              onClick={() => changePage(meta.page - 1)}
              className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-medium transition-colors duration-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={loading || busy || meta.totalPages === 0 || meta.page >= meta.totalPages}
              onClick={() => changePage(meta.page + 1)}
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
