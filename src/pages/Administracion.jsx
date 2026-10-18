import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createAdminUser,
  isAdminUsersAuthenticationError,
  isAdminUsersForbiddenError,
  isAdminUsersRequestCanceled,
  listAdminUsers,
  resetAdminUserPassword,
  updateAdminUser,
} from '../api/admin-users.js'
import { useAuth } from '../auth/AuthContext.jsx'
import DataImportPanel from '../components/admin/DataImportPanel.jsx'
import UserCreateForm from '../components/admin/UserCreateForm.jsx'
import UserManagementPanel from '../components/admin/UserManagementPanel.jsx'
import UsersTable from '../components/admin/UsersTable.jsx'
import {
  createAdminUsersQuery,
  INITIAL_ADMIN_USERS_FILTERS,
} from './admin-users-state.js'

export default function Administracion() {
  const { user: currentUser, checkSession } = useAuth()
  const initialQuery = createAdminUsersQuery(INITIAL_ADMIN_USERS_FILTERS)
  const [draftFilters, setDraftFilters] = useState(INITIAL_ADMIN_USERS_FILTERS)
  const [query, setQuery] = useState(initialQuery)
  const [users, setUsers] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [selection, setSelection] = useState(null)
  const mountedRef = useRef(false)
  const listRequestRef = useRef({ sequence: 0, controller: null })
  const mutationRef = useRef(null)
  const queryRef = useRef(initialQuery)
  const feedbackRef = useRef(null)

  const revalidateAccess = useCallback(async (error) => {
    if (!isAdminUsersAuthenticationError(error) && !isAdminUsersForbiddenError(error)) return
    await checkSession({ blocking: true }).catch(() => {})
  }, [checkSession])

  const revalidateImportAccess = useCallback(async (error) => {
    await revalidateAccess(error)
  }, [revalidateAccess])

  const loadUsers = useCallback(async (requestedQuery) => {
    listRequestRef.current.controller?.abort()
    const controller = new AbortController()
    const sequence = listRequestRef.current.sequence + 1
    listRequestRef.current = { sequence, controller }
    setLoading(true)
    setListError(null)

    try {
      const result = await listAdminUsers(requestedQuery, { signal: controller.signal })
      if (!mountedRef.current || listRequestRef.current.sequence !== sequence) return

      if (result.meta.totalPages > 0 && requestedQuery.page > result.meta.totalPages) {
        const corrected = createAdminUsersQuery(requestedQuery, result.meta.totalPages)
        queryRef.current = corrected
        setQuery(corrected)
        void loadUsers(corrected)
        return
      }

      setUsers(result.users)
      setMeta(result.meta)
      setSelection((current) => {
        if (!current) return null
        const refreshed = result.users.find((item) => item.id === current.user.id)
        return refreshed ? { ...current, user: refreshed } : null
      })
    } catch (error) {
      if (
        isAdminUsersRequestCanceled(error) ||
        !mountedRef.current ||
        listRequestRef.current.sequence !== sequence
      ) {
        return
      }

      setListError(error.message || 'No fue posible cargar las cuentas.')
      await revalidateAccess(error)
    } finally {
      if (mountedRef.current && listRequestRef.current.sequence === sequence) setLoading(false)
    }
  }, [revalidateAccess])

  useEffect(() => {
    mountedRef.current = true
    void loadUsers(initialQuery)

    return () => {
      mountedRef.current = false
      listRequestRef.current.controller?.abort()
      mutationRef.current?.controller.abort()
    }
  }, [loadUsers])

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus()
  }, [feedback])

  async function runMutation(type, operation, successMessage, { endSession = false } = {}) {
    if (mutationRef.current) return false

    const controller = new AbortController()
    mutationRef.current = { type, controller }
    setPendingAction(type)
    setFeedback(null)

    try {
      await operation(controller.signal)
      if (!mountedRef.current) return false

      setFeedback({ type: 'success', message: successMessage })
      if (endSession) {
        await checkSession({ blocking: true }).catch(() => {})
      } else {
        await loadUsers(queryRef.current)
      }
      return true
    } catch (error) {
      if (isAdminUsersRequestCanceled(error) || !mountedRef.current) return false

      setFeedback({
        type: 'error',
        message: error.message || 'No fue posible completar la operación.',
      })
      await revalidateAccess(error)
      return false
    } finally {
      if (mutationRef.current?.controller === controller) {
        mutationRef.current = null
        if (mountedRef.current) setPendingAction(null)
      }
    }
  }

  async function handleCreate(input) {
    return runMutation(
      'create',
      (signal) => createAdminUser(input, { signal }),
      'La cuenta fue creada correctamente.',
    )
  }

  async function handleUpdate(target, patch) {
    const updated = await runMutation(
      'update',
      (signal) => updateAdminUser(target.id, patch, { signal }),
      'La cuenta fue actualizada correctamente.',
    )
    if (updated && mountedRef.current) setSelection(null)
    return updated
  }

  async function handlePasswordReset(target, password) {
    const isCurrent = String(target.id) === String(currentUser.id)
    const reset = await runMutation(
      'password',
      (signal) => resetAdminUserPassword(target.id, password, { signal }),
      isCurrent
        ? 'La contraseña fue actualizada. Debe iniciar sesión nuevamente.'
        : 'La contraseña fue actualizada y las sesiones de la cuenta fueron revocadas.',
      { endSession: isCurrent },
    )
    if (reset && mountedRef.current && !isCurrent) setSelection(null)
    return reset
  }

  function applyFilters(event) {
    event.preventDefault()
    if (loading || busy) return

    const nextQuery = createAdminUsersQuery(draftFilters, 1)
    queryRef.current = nextQuery
    setQuery(nextQuery)
    void loadUsers(nextQuery)
  }

  function changePage(page) {
    if (loading || busy) return

    const nextQuery = createAdminUsersQuery(query, page)
    queryRef.current = nextQuery
    setQuery(nextQuery)
    void loadUsers(nextQuery)
  }

  const busy = pendingAction !== null

  function updateDraftFilter(field, value) {
    if (loading || busy) return
    setDraftFilters((current) => ({ ...current, [field]: value }))
  }

  function refreshUsers() {
    if (loading || busy) return
    void loadUsers(queryRef.current)
  }

  function selectUser(selectedUser, mode) {
    if (loading || busy) return
    setSelection({ user: selectedUser, mode })
  }

  function closeSelection() {
    if (busy) return
    setSelection(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-xl font-semibold text-slate-900">Administración de usuarios</h2>
        <p className="mt-1 text-sm text-slate-600">
          Cree cuentas y controle sus roles, estado y credenciales de acceso.
        </p>
      </header>

      {feedback && (
        <p
          ref={feedbackRef}
          tabIndex={-1}
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.type === 'error'
              ? 'border-critical-100 bg-white text-critical-600'
              : 'border-brand-100 bg-brand-50 text-brand-700'
          }`}
        >
          {feedback.message}
        </p>
      )}

      <UserCreateForm disabled={busy} onCreate={handleCreate} />

      <section aria-labelledby="users-list-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="users-list-title" className="text-base font-semibold text-slate-800">
              Cuentas del sistema
            </h2>
            <p className="mt-1 text-sm text-slate-600">El usuario de acceso no puede modificarse.</p>
          </div>
          <button
            type="button"
            onClick={refreshUsers}
            disabled={loading || busy}
            className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            Actualizar listado
          </button>
        </div>

        <form
          onSubmit={applyFilters}
          className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_auto_auto_auto] md:items-end"
          aria-label="Filtros de cuentas"
        >
          <div>
            <label htmlFor="user-search" className="block text-sm font-medium text-slate-700">
              Buscar
            </label>
            <input
              id="user-search"
              type="search"
              value={draftFilters.search}
              onChange={(event) => updateDraftFilter('search', event.target.value)}
              placeholder="Usuario, nombre o correo"
              maxLength={150}
              disabled={loading || busy}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </div>
          <div>
            <label htmlFor="user-role-filter" className="block text-sm font-medium text-slate-700">
              Rol
            </label>
            <select
              id="user-role-filter"
              value={draftFilters.role}
              onChange={(event) => updateDraftFilter('role', event.target.value)}
              disabled={loading || busy}
              className="mt-1 min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              <option value="">Todos</option>
              <option value="admin">Administrador</option>
              <option value="consulta">Consulta</option>
            </select>
          </div>
          <div>
            <label htmlFor="user-active-filter" className="block text-sm font-medium text-slate-700">
              Estado
            </label>
            <select
              id="user-active-filter"
              value={draftFilters.active}
              onChange={(event) => updateDraftFilter('active', event.target.value)}
              disabled={loading || busy}
              className="mt-1 min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              <option value="">Todos</option>
              <option value="true">Activas</option>
              <option value="false">Inactivas</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={loading || busy}
            className="min-h-11 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            Aplicar filtros
          </button>
        </form>

        {listError && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-critical-100 bg-white px-4 py-3 text-sm text-critical-600" role="alert">
            <span>{listError}</span>
            <button
              type="button"
              onClick={refreshUsers}
              disabled={loading || busy}
              className="min-h-11 rounded-lg bg-critical-600 px-4 py-2 font-medium text-white transition-opacity duration-200 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-critical-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        )}

        <UsersTable
          users={users}
          meta={meta}
          loading={loading}
          busy={busy}
          currentUserId={currentUser.id}
          onSelect={selectUser}
          onPageChange={changePage}
        />
      </section>

      {selection && (
        <UserManagementPanel
          user={selection.user}
          mode={selection.mode}
          currentUserId={currentUser.id}
          disabled={busy}
          onClose={closeSelection}
          onUpdate={handleUpdate}
          onResetPassword={handlePasswordReset}
        />
      )}

      <DataImportPanel onAccessError={revalidateImportAccess} />
    </div>
  )
}
