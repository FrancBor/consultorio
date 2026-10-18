import axios from 'axios'
import http from './http.js'

const DEFAULT_ERROR = 'No fue posible cargar los indicadores. Intente nuevamente.'

export class AnalyticsApiError extends Error {
  constructor(message, { code = 'request_failed', status = null } = {}) {
    super(message)
    this.name = 'AnalyticsApiError'
    this.code = code
    this.status = status
  }
}

function toAnalyticsError(error) {
  if (error instanceof AnalyticsApiError || axios.isCancel(error)) return error

  const code = error?.response?.data?.error?.code
  const status = error?.response?.status ?? null
  let message = DEFAULT_ERROR

  if (code === 'authentication_required') {
    message = 'La sesión expiró. Inicie sesión nuevamente.'
  } else if (code === 'validation_error') {
    message = 'El período seleccionado no es válido.'
  } else if (status >= 500) {
    message = 'El servicio no está disponible temporalmente.'
  } else if (!error?.response) {
    message = 'No fue posible conectar con el servicio.'
  }

  return new AnalyticsApiError(message, { code, status })
}

async function getData(path, filtros, { signal, extraParams } = {}) {
  try {
    const response = await http.get(path, {
      params: { desde: filtros.desde, hasta: filtros.hasta, ...extraParams },
      signal,
    })

    if (!response.data?.data || !response.data?.meta) {
      throw new AnalyticsApiError('El servicio devolvió una respuesta no válida.', {
        code: 'invalid_response',
      })
    }

    return response.data
  } catch (error) {
    throw toAnalyticsError(error)
  }
}

export async function getInasistencia(filtros, options) {
  return (await getData('/indicadores/inasistencia', filtros, options)).data
}

export async function getAtenciones(filtros, options) {
  return (await getData('/indicadores/atenciones', filtros, options)).data
}

export async function getTiempoEspera(filtros, options) {
  return (await getData('/indicadores/tiempo-espera', filtros, options)).data
}

export async function getHorasAgenda(filtros, options) {
  return (await getData('/indicadores/horas-agenda', filtros, options)).data
}

export async function getDemanda(filtros, options) {
  return (await getData('/indicadores/demanda', filtros, options)).data
}

export async function getDetalle(filtros, { signal, page = 1, limit = 25 } = {}) {
  const response = await getData('/atenciones', filtros, {
    signal,
    extraParams: { page, limit },
  })
  return { items: response.data.items, meta: response.meta }
}

export function isAnalyticsRequestCanceled(error) {
  return axios.isCancel(error)
}

export function isAnalyticsAuthenticationRequired(error) {
  return error instanceof AnalyticsApiError && error.code === 'authentication_required'
}
