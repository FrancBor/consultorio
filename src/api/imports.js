import axios from 'axios'
import { getCsrfToken } from './auth.js'
import http from './http.js'

const DEFAULT_ERROR = 'No fue posible completar la importación.'

export class ImportsApiError extends Error {
  constructor(message, { code = 'request_failed', status = null, details = null } = {}) {
    super(message)
    this.name = 'ImportsApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

function safeMessage(error, fallback = DEFAULT_ERROR) {
  const code = error?.response?.data?.error?.code ?? error?.code
  const messages = {
    authentication_required: 'La sesión expiró. Inicie sesión nuevamente.',
    forbidden: 'Su cuenta no tiene permisos vigentes para importar datos.',
    invalid_csrf: 'No fue posible validar la solicitud. Intente nuevamente.',
    file_required: 'Seleccione un archivo CSV o JSON.',
    unsupported_file: 'El archivo debe ser CSV o JSON.',
    empty_file: 'El archivo está vacío.',
    file_too_large: 'El archivo supera el máximo de 5 MiB.',
    invalid_encoding: 'El archivo debe usar codificación UTF-8 válida.',
    invalid_format: 'La estructura del archivo no es válida.',
    invalid_columns: 'El encabezado CSV no coincide con el contrato.',
    too_many_rows: 'El archivo supera el máximo de 50.000 registros.',
    validation_error: 'El archivo contiene datos no válidos.',
    data_conflict: 'Los datos existentes no son compatibles con la importación.',
    import_not_found: 'La importación solicitada ya no existe.',
  }

  if (messages[code]) return messages[code]
  const status = error?.response?.status ?? error?.status
  if (status >= 500) return 'El servicio no está disponible temporalmente.'
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
    return 'La importación tardó demasiado. Intente nuevamente.'
  }
  if (!error?.response) return 'No fue posible conectar con el servicio.'
  return fallback
}

function safeDetails(value) {
  const rawErrors = value?.errores
  if (!Array.isArray(rawErrors)) return null
  const errores = rawErrors.slice(0, 100).flatMap((error) => {
    if (!error || typeof error.mensaje !== 'string') return []
    return [{
      codigo: typeof error.codigo === 'string' ? error.codigo : 'validation_error',
      registro: Number.isInteger(error.registro) && error.registro > 0 ? error.registro : null,
      campo: typeof error.campo === 'string' ? error.campo : null,
      mensaje: error.mensaje,
    }]
  })
  return errores.length > 0
    ? { errores, errores_truncados: value.errores_truncados === true }
    : null
}

function toApiError(error, fallback) {
  if (error instanceof ImportsApiError || axios.isCancel(error)) return error
  return new ImportsApiError(safeMessage(error, fallback), {
    code: error?.response?.data?.error?.code ?? error?.code,
    status: error?.response?.status ?? null,
    details: safeDetails(error?.response?.data?.error?.details),
  })
}

function parseImport(value) {
  if (
    !value ||
    !['string', 'number'].includes(typeof value.id) ||
    !['csv', 'json'].includes(value.formato) ||
    typeof value.nombre_archivo !== 'string' ||
    !Number.isInteger(value.cantidad_registros) ||
    !Number.isInteger(value.cantidad_insertados) ||
    !Number.isInteger(value.cantidad_actualizados) ||
    !Number.isInteger(value.cantidad_omitidos) ||
    typeof value.importado_en !== 'string' ||
    !Number.isFinite(Date.parse(value.importado_en)) ||
    value.cantidad_registros < 0 ||
    value.cantidad_insertados < 0 ||
    value.cantidad_actualizados < 0 ||
    value.cantidad_omitidos < 0 ||
    value.cantidad_insertados + value.cantidad_actualizados + value.cantidad_omitidos !==
      value.cantidad_registros ||
    (value.usuario !== undefined && value.usuario !== null && typeof value.usuario !== 'string') ||
    (value.nombre_usuario !== undefined &&
      value.nombre_usuario !== null &&
      typeof value.nombre_usuario !== 'string')
  ) {
    throw new ImportsApiError('El servicio devolvió una respuesta no válida.', {
      code: 'invalid_response',
    })
  }
  return {
    id: String(value.id),
    formato: value.formato,
    nombre_archivo: value.nombre_archivo,
    cantidad_registros: value.cantidad_registros,
    cantidad_insertados: value.cantidad_insertados,
    cantidad_actualizados: value.cantidad_actualizados,
    cantidad_omitidos: value.cantidad_omitidos,
    importado_en: value.importado_en,
    usuario: value.usuario ?? null,
    nombre_usuario: value.nombre_usuario ?? null,
  }
}

export async function listImports({ page = 1, limit = 20 } = {}, { signal } = {}) {
  try {
    const response = await http.get('/admin/importaciones', { params: { page, limit }, signal })
    const items = response.data?.data?.importaciones
    const meta = response.data?.meta
    if (
      !Array.isArray(items) ||
      !meta ||
      !Number.isInteger(meta.page) ||
      !Number.isInteger(meta.limit) ||
      !Number.isInteger(meta.total) ||
      !Number.isInteger(meta.totalPages)
    ) {
      throw new ImportsApiError('El servicio devolvió una respuesta no válida.', {
        code: 'invalid_response',
      })
    }
    return { imports: items.map(parseImport), meta }
  } catch (error) {
    throw toApiError(error, 'No fue posible cargar el historial.')
  }
}

export async function getImport(importId, { signal } = {}) {
  try {
    const response = await http.get(`/admin/importaciones/${encodeURIComponent(importId)}`, {
      signal,
    })
    return parseImport(response.data?.data?.importacion)
  } catch (error) {
    throw toApiError(error, 'No fue posible cargar el detalle de la importación.')
  }
}

export async function uploadImport(file, { signal, onProgress } = {}) {
  try {
    const csrfToken = await getCsrfToken(signal, DEFAULT_ERROR)
    const form = new FormData()
    form.append('archivo', file)
    const response = await http.post('/admin/importaciones', form, {
      signal,
      timeout: 120_000,
      headers: { 'X-CSRF-Token': csrfToken },
      onUploadProgress(event) {
        if (!event.total || !onProgress) return
        onProgress(Math.min(100, Math.round((event.loaded * 100) / event.total)))
      },
    })
    return {
      import: parseImport(response.data?.data?.importacion),
      repeated: response.data?.meta?.repetida === true,
    }
  } catch (error) {
    throw toApiError(error)
  }
}

export function isImportsRequestCanceled(error) {
  return axios.isCancel(error)
}

export function isImportsAccessError(error) {
  return (
    error instanceof ImportsApiError &&
    ['authentication_required', 'forbidden'].includes(error.code)
  )
}
