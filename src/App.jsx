import { useEffect, useRef, useState } from 'react'
import { useAuth } from './auth/AuthContext.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Administracion from './pages/Administracion.jsx'

export default function App() {
  const { user, status, sessionError, checkSession } = useAuth()
  const [view, setView] = useState('dashboard')
  const lastRevalidationRef = useRef(0)

  useEffect(() => {
    if (view === 'admin' && user?.rol !== 'admin') setView('dashboard')
  }, [user, view])

  useEffect(() => {
    function revalidateVisibleSession() {
      if (status !== 'authenticated' || document.visibilityState !== 'visible') return

      const now = Date.now()
      if (now - lastRevalidationRef.current < 500) return
      lastRevalidationRef.current = now

      void checkSession({ blocking: view === 'admin' }).catch(() => {})
    }

    window.addEventListener('focus', revalidateVisibleSession)
    document.addEventListener('visibilitychange', revalidateVisibleSession)

    return () => {
      window.removeEventListener('focus', revalidateVisibleSession)
      document.removeEventListener('visibilitychange', revalidateVisibleSession)
    }
  }, [checkSession, status, view])

  async function handleChangeView(nextView) {
    if (nextView !== 'admin') {
      setView(nextView)
      return
    }

    try {
      const currentUser = await checkSession({ blocking: true })
      setView(currentUser?.rol === 'admin' ? 'admin' : 'dashboard')
    } catch {
      // El estado de error bloqueante evita renderizar Administración.
    }
  }

  if (status === 'checking') {
    return (
      <main
        className="min-h-screen flex items-center justify-center bg-brand-50 px-4"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="flex flex-col items-center gap-3 text-center text-slate-700" role="status">
          <span
            className="h-7 w-7 rounded-full border-2 border-brand-100 border-t-brand-600 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <p className="text-sm font-medium">
            {user ? 'Verificando permisos…' : 'Comprobando sesión…'}
          </p>
        </div>
      </main>
    )
  }

  if (status === 'error') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-brand-50 px-4">
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">No fue posible comprobar la sesión</h1>
          <p className="mt-2 text-sm text-slate-600" role="alert">
            {sessionError}
          </p>
          <button
            type="button"
            onClick={() => void checkSession({ blocking: true }).catch(() => {})}
            className="mt-5 min-h-11 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      </main>
    )
  }

  if (status === 'anonymous' || !user) return <Login />

  const vistaActiva = view === 'admin' && user.rol !== 'admin' ? 'dashboard' : view

  return (
    <Layout view={vistaActiva} onChangeView={handleChangeView}>
      {vistaActiva === 'admin' ? <Administracion /> : <Dashboard />}
    </Layout>
  )
}
