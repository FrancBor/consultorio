import axios from 'axios'
import { getCsrfToken } from './auth.js'
import http from './http.js'

const DEFAULT_ERROR = 'No fue posible completar la operación. Intente nuevamente.'

export class AdminUsersApiError extends Error {
  constructor(message, { code = 'request_failed', status = null } = {}) {
    super(message)
    this.name = 'AdminUsersApiError'
    this.code = code
    this.status = status
  }
}

function safeMessage(error, fallbackMessage) {
  const code = error?.response?.data?.error?.code ?? error?.code
  const status = error?.response?.status ?? error?.status ?? null
  const messages = {
    authentication_required: 'La sesión expiró. Inicie sesión nuevamente.',
    forbidden: 'Su cuenta no tiene permisos vigentes para administrar usuarios.',
    invalid_csrf: 'No fue posible validar la solicitud. Intente nuevamente.',
    validation_error: 'Revise los datos ingresados.',
    duplicate_username: 'El nombre de usuario ya existe.',
    duplicate_email: 'El correo ya está asociado a otra cuenta.',
    user_not_found: 'La cuenta ya no existe.',
    self_protection: 'No puede desactivar ni degradar su propia cuenta.',
    last_active_admin: 'Debe existir al menos una cuenta administradora activa.',
  }

  if (messages[code]) return messages[code]
  if (status >= 500) return 'El servicio no está disponible temporalmente.'
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
    return 'La solicitud tardó demasiado. Intente nuevamente.'
  }
  if (!error?.response && error?.name !== 'AuthApiError') {
    return 'No fue posible conectar con el servicio.'
  }

  return error?.message || fallbackMessage
}

function toApiError(error, fallbackMessage = DEFAULT_ERROR) {
  if (error instanceof AdminUsersApiError || axios.isCancel(error)) return error

  return new AdminUsersApiError(safeMessage(error, fallbackMessage), {
    code: error?.response?.data?.error?.code ?? error?.code,
    status: error?.response?.status ?? error?.status,
  })
}

function parseUser(payload) {
  const user = payload?.data?.user ?? payload

  if (
    !user ||
    !['string', 'number'].includes(typeof user.id) ||
    typeof user.usuario !== 'string' ||
    typeof user.nombre !== 'string' ||
    !['admin', 'consulta'].includes(user.rol) ||
    typeof user.activo !== 'boolean' ||
    (user.correo !== null && typeof user.correo !== 'string') ||
    Object.keys(user).some((key) => /password|hash/i.test(key))
  ) {
    throw new AdminUsersApiError('El servicio devolvió una respuesta no válida.', {
      code: 'invalid_response',
    })
  }

  return {
    id: String(user.id),
    usuario: user.usuario,
    nombre: user.nombre,
    correo: user.correo,
    rol: user.rol,
    activo: user.activo,
    ultimo_acceso_en: user.ultimo_acceso_en ?? null,
    creado_en: user.creado_en,
    actualizado_en: user.actualizado_en,
  }
}

function parseList(payload) {
  const users = payload?.data?.users
  const meta = payload?.meta

  if (
    !Array.isArray(users) ||
    !meta ||
    !Number.isInteger(meta.page) ||
    !Number.isInteger(meta.limit) ||
    !Number.isInteger(meta.total) ||
    !Number.isInteger(meta.totalPages)
  ) {
    throw new AdminUsersApiError('El servicio devolvió una respuesta no válida.', {
      code: 'invalid_response',
    })
  }

  return { users: users.map(parseUser), meta }
}

function queryParams(filters) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined),
  )
}

async function mutation(method, path, body, { signal, fallbackMessage } = {}) {
  try {
    const csrfToken = await getCsrfToken(signal, fallbackMessage ?? DEFAULT_ERROR)
    const response = await http.request({
      method,
      url: path,
      data: body,
      signal,
      headers: { 'X-CSRF-Token': csrfToken },
    })
    return parseUser(response.data)
  } catch (error) {
    throw toApiError(error, fallbackMessage)
  }
}

export async function listAdminUsers(filters, { signal } = {}) {
  try {
    const response = await http.get('/admin/usuarios', {
      params: queryParams(filters),
      signal,
    })
    return parseList(response.data)
  } catch (error) {
    throw toApiError(error, 'No fue posible cargar las cuentas.')
  }
}

export function createAdminUser(input, options = {}) {
  return mutation('post', '/admin/usuarios', input, {
    ...options,
    fallbackMessage: 'No fue posible crear la cuenta.',
  })
}

export function updateAdminUser(userId, patch, options = {}) {
  return mutation('patch', `/admin/usuarios/${encodeURIComponent(userId)}`, patch, {
    ...options,
    fallbackMessage: 'No fue posible actualizar la cuenta.',
  })
}

export function resetAdminUserPassword(userId, password, options = {}) {
  return mutation(
    'post',
    `/admin/usuarios/${encodeURIComponent(userId)}/password`,
    { password },
    {
      ...options,
      fallbackMessage: 'No fue posible restablecer la contraseña.',
    },
  )
}

export function isAdminUsersRequestCanceled(error) {
  return axios.isCancel(error)
}

export function isAdminUsersAuthenticationError(error) {
  return error instanceof AdminUsersApiError && error.code === 'authentication_required'
}

export function isAdminUsersForbiddenError(error) {
  return error instanceof AdminUsersApiError && error.code === 'forbidden'
}
