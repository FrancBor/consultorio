import { useEffect, useRef, useState } from 'react'
import { isAuthenticationRequiredError } from '../api/auth.js'
import { useAuth } from '../auth/AuthContext.jsx'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', rolMinimo: null },
  { id: 'admin', label: 'Administración', rolMinimo: 'admin' },
]

export default function Layout({ view, onChangeView, children }) {
  const { user, logout } = useAuth()
  const tabsVisibles = TABS.filter((t) => !t.rolMinimo || t.rolMinimo === user.rol)
  const [logoutError, setLogoutError] = useState(null)
  const [cerrandoSesion, setCerrandoSesion] = useState(false)
  const cerrandoRef = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function handleLogout() {
    if (cerrandoRef.current) return

    cerrandoRef.current = true
    setCerrandoSesion(true)
    setLogoutError(null)

    try {
      await logout()
    } catch (error) {
      if (!mountedRef.current || isAuthenticationRequiredError(error)) return

      setLogoutError(error.message || 'No fue posible cerrar la sesión. Intente nuevamente.')
      setCerrandoSesion(false)
      cerrandoRef.current = false
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xl font-medium uppercase tracking-wide text-brand-600">
              Gestión Inteligente CESFAM
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">
              CESFAM Profesor Eugenio Cienfuegos — Dashboard de gestión
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-600">
              <span className="h-2 w-2 rounded-full bg-brand-600" aria-hidden="true" />
              {user.nombre}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={cerrandoSesion}
              className="min-h-11 text-sm font-medium text-slate-500 hover:text-critical-600 transition-colors duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-600 rounded px-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cerrandoSesion ? 'Cerrando sesión…' : 'Cerrar sesión'}
            </button>
          </div>
        </div>

        {logoutError && (
          <div className="mx-auto max-w-6xl px-6 pb-3">
            <p
              role="alert"
              className="rounded-lg bg-critical-100 px-3 py-2 text-sm text-critical-600"
            >
              {logoutError}
            </p>
          </div>
        )}

        {tabsVisibles.length > 1 && (
          <nav className="mx-auto max-w-6xl px-6 flex gap-1" aria-label="Secciones">
            {tabsVisibles.map((tab) => {
              const activo = view === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onChangeView(tab.id)}
                  aria-current={activo ? 'page' : undefined}
                  className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-brand-600 rounded-t ${
                    activo
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  )
}
