import axios from 'axios'
import http from './http.js'

const DEFAULT_ERROR = 'No fue posible completar la solicitud. Intente nuevamente.'

export class AuthApiError extends Error {
  constructor(message, { code = 'request_failed', status = null } = {}) {
    super(message)
    this.name = 'AuthApiError'
    this.code = code
    this.status = status
  }
}

function safeMessage(error, fallbackMessage) {
  const code = error?.response?.data?.error?.code
  const status = error?.response?.status ?? null

  if (code === 'invalid_credentials') return 'Usuario o contraseña incorrectos.'
  if (code === 'rate_limit_exceeded') {
    return 'Demasiados intentos de inicio de sesión. Intente más tarde.'
  }
  if (code === 'validation_error') return 'Revise el usuario y la contraseña ingresados.'
  if (code === 'invalid_csrf') {
    return 'No fue posible validar la solicitud. Intente nuevamente.'
  }
  if (code === 'authentication_required') {
    return 'La sesión expiró. Inicie sesión nuevamente.'
  }
  if (status >= 500) return 'El servicio no está disponible temporalmente.'
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
    return 'La solicitud tardó demasiado. Intente nuevamente.'
  }
  if (!error?.response) return 'No fue posible conectar con el servicio.'

  return fallbackMessage
}

function toAuthApiError(error, fallbackMessage = DEFAULT_ERROR) {
  if (error instanceof AuthApiError || axios.isCancel(error)) return error

  return new AuthApiError(safeMessage(error, fallbackMessage), {
    code: error?.response?.data?.error?.code,
    status: error?.response?.status,
  })
}

function parseUser(data) {
  const user = data?.user

  if (
    !user ||
    typeof user.usuario !== 'string' ||
    typeof user.nombre !== 'string' ||
    typeof user.rol !== 'string'
  ) {
    throw new AuthApiError('El servicio devolvió una respuesta no válida.', {
      code: 'invalid_response',
    })
  }

  return user
}

export async function getCsrfToken(signal, fallbackMessage) {
  try {
    const response = await http.get('/auth/csrf', { signal })
    const token = response.data?.csrfToken

    if (typeof token !== 'string' || token.length === 0) {
      throw new AuthApiError('No fue posible validar la solicitud.', {
        code: 'invalid_response',
      })
    }

    return token
  } catch (error) {
    throw toAuthApiError(error, fallbackMessage)
  }
}

export async function getCurrentUser({ signal } = {}) {
  try {
    const response = await http.get('/auth/me', { signal })
    return parseUser(response.data)
  } catch (error) {
    if (error?.response?.status === 401) return null
    throw toAuthApiError(error, 'No fue posible comprobar la sesión.')
  }
}

export async function login(usuario, password, { signal } = {}) {
  const fallbackMessage = 'No fue posible iniciar sesión. Intente nuevamente.'
  const csrfToken = await getCsrfToken(signal, fallbackMessage)

  try {
    const response = await http.post(
      '/auth/login',
      { usuario, password },
      { headers: { 'X-CSRF-Token': csrfToken }, signal },
    )
    return parseUser(response.data)
  } catch (error) {
    throw toAuthApiError(error, fallbackMessage)
  }
}

export async function logout({ signal } = {}) {
  const fallbackMessage = 'No fue posible cerrar la sesión. Intente nuevamente.'
  const csrfToken = await getCsrfToken(signal, fallbackMessage)

  try {
    await http.post('/auth/logout', undefined, {
      headers: { 'X-CSRF-Token': csrfToken },
      signal,
    })
  } catch (error) {
    throw toAuthApiError(error, fallbackMessage)
  }
}

export function isAuthRequestCanceled(error) {
  return axios.isCancel(error)
}

export function isAuthenticationRequiredError(error) {
  return error instanceof AuthApiError && error.code === 'authentication_required'
}
