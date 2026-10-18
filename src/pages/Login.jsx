import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext.jsx'

const EMPTY_FIELD_ERRORS = { usuario: null, password: null }

export default function Login() {
  const { login, sessionNotice } = useAuth()
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState(EMPTY_FIELD_ERRORS)
  const [formError, setFormError] = useState(null)
  const [cargando, setCargando] = useState(false)
  const formErrorRef = useRef(null)
  const usuarioRef = useRef(null)
  const passwordRef = useRef(null)
  const enviandoRef = useRef(false)
  const mountedRef = useRef(false)
  const focusFrameRef = useRef(null)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
    }
  }, [])

  function focusNextFrame(elementRef) {
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current)
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null
      if (mountedRef.current) elementRef.current?.focus()
    })
  }

  function handleUsuarioChange(event) {
    setUsuario(event.target.value)
    setFieldErrors((current) => ({ ...current, usuario: null }))
    setFormError(null)
  }

  function handlePasswordChange(event) {
    setPassword(event.target.value)
    setFieldErrors((current) => ({ ...current, password: null }))
    setFormError(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (enviandoRef.current) return

    const usuarioNormalizado = usuario.trim()

    if (!usuarioNormalizado) {
      setFieldErrors({ usuario: 'Ingrese su usuario.', password: null })
      setFormError(null)
      focusNextFrame(usuarioRef)
      return
    }

    if (!password) {
      setFieldErrors({ usuario: null, password: 'Ingrese su contraseña.' })
      setFormError(null)
      focusNextFrame(passwordRef)
      return
    }

    enviandoRef.current = true
    setFieldErrors(EMPTY_FIELD_ERRORS)
    setFormError(null)
    setCargando(true)

    try {
      await login(usuarioNormalizado, password)
    } catch (requestError) {
      if (!mountedRef.current) return

      setPassword('')
      setFormError(requestError.message || 'No fue posible iniciar sesión. Intente nuevamente.')
      setCargando(false)
      enviandoRef.current = false
      focusNextFrame(formErrorRef)
    }
  }

  const visibleFormMessage = formError ?? sessionNotice

  return (
    <main className="min-h-screen flex items-center justify-center bg-brand-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
            Gestión Inteligente CESFAM
          </p>
          <h1 className="text-xl font-semibold text-slate-900 mt-1">
            CESFAM Profesor Eugenio Cienfuegos
          </h1>
          <p className="text-sm text-slate-500 mt-1">Dashboard de gestión — acceso restringido</p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="rounded-xl bg-white border border-slate-200 shadow-sm p-6 flex flex-col gap-4"
        >
          {visibleFormMessage && (
            <div
              ref={formErrorRef}
              role="alert"
              tabIndex={-1}
              className="rounded-lg bg-critical-100 text-critical-600 text-sm px-3 py-2 outline-none"
            >
              {visibleFormMessage}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="login-usuario" className="text-sm font-medium text-slate-700">
              Usuario
            </label>
            <input
              id="login-usuario"
              ref={usuarioRef}
              name="usuario"
              type="text"
              autoComplete="username"
              value={usuario}
              onChange={handleUsuarioChange}
              required
              aria-invalid={Boolean(fieldErrors.usuario)}
              aria-describedby={fieldErrors.usuario ? 'login-usuario-error' : undefined}
              className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            />
            {fieldErrors.usuario && (
              <p id="login-usuario-error" className="text-sm text-critical-600">
                {fieldErrors.usuario}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="login-password" className="text-sm font-medium text-slate-700">
              Contraseña
            </label>
            <input
              id="login-password"
              ref={passwordRef}
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={handlePasswordChange}
              required
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
              className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            />
            {fieldErrors.password && (
              <p id="login-password-error" className="text-sm text-critical-600">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={cargando}
            className="mt-2 min-h-11 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
          >
            {cargando ? (
              <>
                <span
                  className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                Ingresando…
              </>
            ) : (
              'Ingresar'
            )}
          </button>
        </form>
      </div>
    </main>
  )
}
