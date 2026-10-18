import { useCallback, useEffect, useRef, useState } from 'react'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import KpiCard from '../components/KpiCard.jsx'
import GraficoTendencia from '../components/GraficoTendencia.jsx'
import GraficoComparativo from '../components/GraficoComparativo.jsx'
import TablaDetalle from '../components/TablaDetalle.jsx'
import { useAuth } from '../auth/AuthContext.jsx'
import {
  getInasistencia,
  getAtenciones,
  getTiempoEspera,
  getHorasAgenda,
  getDemanda,
  getDetalle,
  isAnalyticsAuthenticationRequired,
  isAnalyticsRequestCanceled,
} from '../api/client.js'
import {
  createDashboardAttempt,
  isDashboardDataEmpty,
  retryDashboardAttempt,
} from './dashboard-state.js'

const INITIAL_FILTER = Object.freeze({ desde: '2026-04-01', hasta: '2026-09-30' })
const DETAIL_LIMIT = 25
const UMBRAL_INASISTENCIA_CRITICO = 0.2
const UMBRAL_INASISTENCIA_ALERTA = 0.15

const pct = (value) => (value == null ? '—' : `${Math.round(value * 100)}%`)
const min = (value) => (value == null ? '—' : `${value.toLocaleString('es-CL')} min`)

export default function Dashboard() {
  const { checkSession } = useAuth()
  const initialAttempt = createDashboardAttempt(INITIAL_FILTER, 1)
  const [editableFilter, setEditableFilter] = useState(INITIAL_FILTER)
  const [attempt, setAttempt] = useState(initialAttempt)
  const [displayedAttempt, setDisplayedAttempt] = useState(initialAttempt)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)
  const requestRef = useRef({ sequence: 0, controller: null })

  const cargarDatos = useCallback(async (filters, requestedPage = 1) => {
    const nextAttempt = createDashboardAttempt(filters, requestedPage)
    setAttempt(nextAttempt)
    requestRef.current.controller?.abort()
    const controller = new AbortController()
    const sequence = requestRef.current.sequence + 1
    requestRef.current = { sequence, controller }
    setLoading(true)
    setError(null)

    try {
      const options = { signal: controller.signal }
      const [inasistencia, atenciones, tiempoEspera, horasAgenda, demanda, detalle] =
        await Promise.all([
          getInasistencia(nextAttempt.filters, options),
          getAtenciones(nextAttempt.filters, options),
          getTiempoEspera(nextAttempt.filters, options),
          getHorasAgenda(nextAttempt.filters, options),
          getDemanda(nextAttempt.filters, options),
          getDetalle(nextAttempt.filters, {
            signal: controller.signal,
            page: nextAttempt.page,
            limit: DETAIL_LIMIT,
          }),
        ])

      if (requestRef.current.sequence !== sequence) return
      setData({ inasistencia, atenciones, tiempoEspera, horasAgenda, demanda, detalle })
      setDisplayedAttempt(nextAttempt)
    } catch (requestError) {
      if (isAnalyticsRequestCanceled(requestError) || requestRef.current.sequence !== sequence) {
        return
      }

      setError(requestError.message || 'No fue posible cargar los indicadores.')
      if (isAnalyticsAuthenticationRequired(requestError)) {
        await checkSession({ blocking: true }).catch(() => {})
      }
    } finally {
      if (requestRef.current.sequence === sequence) setLoading(false)
    }
  }, [checkSession])

  useEffect(() => {
    void cargarDatos(INITIAL_FILTER, 1)
    return () => requestRef.current.controller?.abort()
  }, [cargarDatos])

  const inasistenciaStatus =
    data?.inasistencia.resumen.tasa == null
      ? 'normal'
      : data.inasistencia.resumen.tasa >= UMBRAL_INASISTENCIA_CRITICO
        ? 'critical'
        : data.inasistencia.resumen.tasa >= UMBRAL_INASISTENCIA_ALERTA
          ? 'warn'
          : 'normal'
  const isEmpty = isDashboardDataEmpty(data)

  function applyFilters() {
    void cargarDatos(editableFilter, 1)
  }

  function changePage(nextPage) {
    void cargarDatos(displayedAttempt.filters, nextPage)
  }

  function retryLastAttempt() {
    const retry = retryDashboardAttempt(attempt)
    void cargarDatos(retry.filters, retry.page)
  }

  return (
    <div className="flex flex-col gap-6">
      <FiltroPeriodo
        desde={editableFilter.desde}
        hasta={editableFilter.hasta}
        onChange={setEditableFilter}
        onAplicar={applyFilters}
        disabled={loading}
      />

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-critical-100 bg-white px-4 py-3 text-sm text-critical-600 shadow-sm"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={retryLastAttempt}
            className="min-h-11 rounded-lg bg-critical-600 px-4 py-2 font-medium text-white transition-colors duration-200 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-critical-600 focus-visible:ring-offset-2 cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}

      {isEmpty && !error && (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-center text-sm text-slate-600" role="status">
          No existen datos para el período seleccionado. Ajuste las fechas e intente nuevamente.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4" aria-busy={loading}>
        <KpiCard
          label="Tasa de inasistencia"
          value={data ? pct(data.inasistencia.resumen.tasa) : '—'}
          sublabel={data ? `${data.inasistencia.resumen.total_inasistencias} de ${data.inasistencia.resumen.total_agendadas} horas` : ''}
          status={inasistenciaStatus}
          loading={loading}
        />
        <KpiCard
          label="Atenciones realizadas"
          value={data ? data.atenciones.resumen.total.toLocaleString('es-CL') : '—'}
          sublabel="En el período seleccionado"
          loading={loading}
        />
        <KpiCard
          label="Tiempo promedio de espera"
          value={data ? min(data.tiempoEspera.resumen.promedio_minutos) : '—'}
          sublabel="Solo atenciones con espera informada"
          loading={loading}
        />
        <KpiCard
          label="Uso de horas agendadas"
          value={data ? pct(data.horasAgenda.resumen.porcentaje_uso) : '—'}
          sublabel={data ? `${data.horasAgenda.resumen.utilizadas} de ${data.horasAgenda.resumen.agendadas}` : ''}
          loading={loading}
        />
        <KpiCard
          label="Demanda del período"
          value={data ? data.demanda.resumen.total_solicitadas.toLocaleString('es-CL') : '—'}
          sublabel="Solicitudes recibidas"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GraficoTendencia
          title="Tendencia — Tasa de inasistencia"
          data={data?.inasistencia.serie ?? []}
          formatValue={pct}
        />
        <GraficoTendencia
          title="Tendencia — Tiempo promedio de espera"
          data={data?.tiempoEspera.serie ?? []}
          formatValue={min}
        />
        <GraficoTendencia
          title="Tendencia — Atenciones realizadas"
          data={data?.atenciones.serie ?? []}
          formatValue={(value) => value ?? '—'}
        />
        <GraficoComparativo title="Horas agendadas vs. utilizadas" data={data?.horasAgenda.serie ?? []} />
      </div>

      <TablaDetalle
        rows={data?.detalle.items ?? []}
        meta={data?.detalle.meta}
        loading={loading}
        onPageChange={changePage}
      />
    </div>
  )
}
