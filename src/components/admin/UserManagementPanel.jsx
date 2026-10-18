import { useEffect, useRef, useState } from 'react'

export default function UserManagementPanel({
  user,
  mode,
  currentUserId,
  disabled,
  onClose,
  onUpdate,
  onResetPassword,
}) {
  const [name, setName] = useState(user.nombre)
  const [role, setRole] = useState(user.rol)
  const [active, setActive] = useState(user.activo)
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [validationError, setValidationError] = useState(null)
  const titleRef = useRef(null)
  const errorRef = useRef(null)
  const isCurrent = String(user.id) === String(currentUserId)

  useEffect(() => {
    setName(user.nombre)
    setRole(user.rol)
    setActive(user.activo)
    setPassword('')
    setPasswordConfirmation('')
    setValidationError(null)
    titleRef.current?.focus()
  }, [mode, user])

  useEffect(() => {
    if (validationError) errorRef.current?.focus()
  }, [validationError])

  async function handleUpdate(event) {
    event.preventDefault()
    setValidationError(null)

    if (name.trim().length < 2) {
      setValidationError('El nombre debe tener al menos 2 caracteres.')
      return
    }

    const deactivatesAccount = user.activo && !active
    const demotesAdministrator = user.rol === 'admin' && role === 'consulta'

    if (demotesAdministrator) {
      const consequence = deactivatesAccount
        ? 'Perderá los privilegios administrativos, la cuenta quedará inactiva y se cerrarán todas sus sesiones.'
        : 'Perderá los privilegios administrativos y se cerrarán todas sus sesiones activas.'
      const confirmed = window.confirm(
        `¿Cambiar la cuenta ${user.usuario} de Administrador a Consulta? ${consequence}`,
      )
      if (!confirmed) return
    } else if (deactivatesAccount) {
      const confirmed = window.confirm(
        `¿Desactivar la cuenta ${user.usuario}? Se cerrarán todas sus sesiones activas.`,
      )
      if (!confirmed) return
    }

    await onUpdate(user, { nombre: name, rol: role, activo: active })
  }

  async function handlePasswordReset(event) {
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

    const consequence = isCurrent
      ? 'Su sesión se cerrará y deberá iniciar sesión nuevamente.'
      : 'Todas las sesiones activas de esta cuenta se cerrarán.'
    if (!window.confirm(`¿Restablecer la contraseña de ${user.usuario}? ${consequence}`)) return

    await onResetPassword(user, submittedPassword)
  }

  return (
    <section className="rounded-xl border border-brand-100 bg-white p-5 shadow-sm" aria-labelledby="manage-user-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="manage-user-title"
            ref={titleRef}
            tabIndex={-1}
            className="text-base font-semibold text-slate-800"
          >
            {mode === 'edit' ? 'Editar cuenta' : 'Restablecer contraseña'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {user.nombre} · <span className="font-mono text-xs">{user.usuario}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={disabled}
          className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors duration-200 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          Cerrar
        </button>
      </div>

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

      {mode === 'edit' ? (
        <form className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3" onSubmit={handleUpdate}>
          <div>
            <label htmlFor="edit-user-name" className="block text-sm font-medium text-slate-700">
              Nombre visible
            </label>
            <input
              id="edit-user-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              minLength={2}
              maxLength={150}
              disabled={disabled}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </div>
          <div>
            <label htmlFor="edit-user-role" className="block text-sm font-medium text-slate-700">
              Rol
            </label>
            <select
              id="edit-user-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              disabled={disabled || isCurrent}
              aria-describedby={isCurrent ? 'self-protection-help' : undefined}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              <option value="consulta">Consulta</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <div>
            <span className="block text-sm font-medium text-slate-700">Estado</span>
            <label className="mt-1 flex min-h-11 items-center gap-3 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
                disabled={disabled || isCurrent}
                aria-describedby={isCurrent ? 'self-protection-help' : undefined}
                className="h-5 w-5 accent-brand-600"
              />
              Cuenta activa
            </label>
          </div>
          {isCurrent && (
            <p id="self-protection-help" className="text-sm text-slate-600 md:col-span-3">
              No puede cambiar su propio rol ni desactivar su cuenta desde esta sesión.
            </p>
          )}
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={disabled}
              className="min-h-11 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
            >
              {disabled ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      ) : (
        <form className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={handlePasswordReset}>
          <div>
            <label htmlFor="reset-user-password" className="block text-sm font-medium text-slate-700">
              Nueva contraseña
            </label>
            <input
              id="reset-user-password"
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
            <label htmlFor="reset-user-password-confirmation" className="block text-sm font-medium text-slate-700">
              Confirmar contraseña
            </label>
            <input
              id="reset-user-password-confirmation"
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
          <p className="text-sm text-slate-600 md:col-span-2">
            {isCurrent
              ? 'Al confirmar, esta sesión se revocará y deberá iniciar sesión nuevamente.'
              : 'Al confirmar, todas las sesiones activas de esta cuenta se revocarán.'}
          </p>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={disabled}
              className="min-h-11 rounded-lg bg-critical-600 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-critical-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
            >
              {disabled ? 'Restableciendo…' : 'Restablecer contraseña'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
