import { useEffect, useRef, useState } from 'react'

const INITIAL_FORM = {
  usuario: '',
  nombre: '',
  correo: '',
  rol: 'consulta',
}

export default function UserCreateForm({ disabled, onCreate }) {
  const [form, setForm] = useState(INITIAL_FORM)
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [validationError, setValidationError] = useState(null)
  const mountedRef = useRef(false)
  const errorRef = useRef(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (validationError) errorRef.current?.focus()
  }, [validationError])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setValidationError(null)

    const submittedPassword = password
    setPassword('')
    setPasswordConfirmation('')

    if (submittedPassword.length < 12) {
      setValidationError('La contraseña debe tener al menos 12 caracteres.')
      return
    }
    if (submittedPassword !== passwordConfirmation) {
      setValidationError('Las contraseñas no coinciden.')
      return
    }

    const created = await onCreate({ ...form, password: submittedPassword })
    if (created && mountedRef.current) setForm(INITIAL_FORM)
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="create-user-title">
      <h2 id="create-user-title" className="text-base font-semibold text-slate-800">
        Crear cuenta
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        La contraseña se cifra en el servidor y nunca vuelve a mostrarse.
      </p>

      {validationError && (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="mt-4 rounded-lg bg-critical-100 px-3 py-2 text-sm text-critical-600"
        >
          {validationError}
        </p>
      )}

      <form className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="new-user-username" className="block text-sm font-medium text-slate-700">
            Usuario
          </label>
          <input
            id="new-user-username"
            name="usuario"
            value={form.usuario}
            onChange={updateField}
            required
            minLength={3}
            maxLength={100}
            pattern="[A-Za-z0-9._-]+"
            autoComplete="off"
            disabled={disabled}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </div>
        <div>
          <label htmlFor="new-user-name" className="block text-sm font-medium text-slate-700">
            Nombre visible
          </label>
          <input
            id="new-user-name"
            name="nombre"
            value={form.nombre}
            onChange={updateField}
            required
            minLength={2}
            maxLength={150}
            autoComplete="name"
            disabled={disabled}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </div>
        <div>
          <label htmlFor="new-user-email" className="block text-sm font-medium text-slate-700">
            Correo <span className="font-normal text-slate-500">(opcional)</span>
          </label>
          <input
            id="new-user-email"
            name="correo"
            type="email"
            value={form.correo}
            onChange={updateField}
            maxLength={254}
            autoComplete="email"
            disabled={disabled}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </div>
        <div>
          <label htmlFor="new-user-role" className="block text-sm font-medium text-slate-700">
            Rol
          </label>
          <select
            id="new-user-role"
            name="rol"
            value={form.rol}
            onChange={updateField}
            disabled={disabled}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
          >
            <option value="consulta">Consulta</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        <div>
          <label htmlFor="new-user-password" className="block text-sm font-medium text-slate-700">
            Contraseña
          </label>
          <input
            id="new-user-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={12}
            maxLength={1024}
            autoComplete="new-password"
            disabled={disabled}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </div>
        <div>
          <label htmlFor="new-user-password-confirmation" className="block text-sm font-medium text-slate-700">
            Confirmar contraseña
          </label>
          <input
            id="new-user-password-confirmation"
            type="password"
            value={passwordConfirmation}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            required
            minLength={12}
            maxLength={1024}
            autoComplete="new-password"
            disabled={disabled}
            className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
          />
        </div>
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={disabled}
            className="min-h-11 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            {disabled ? 'Procesando…' : 'Crear cuenta'}
          </button>
        </div>
      </form>
    </section>
  )
}
