export function createDashboardAttempt(filters, page = 1) {
  return Object.freeze({
    filters: Object.freeze({ desde: filters.desde, hasta: filters.hasta }),
    page,
  })
}

export function retryDashboardAttempt(attempt) {
  return createDashboardAttempt(attempt.filters, attempt.page)
}

export function isDashboardDataEmpty(data) {
  if (!data) return false

  const totals = [
    data.inasistencia?.resumen?.total_agendadas,
    data.inasistencia?.resumen?.total_inasistencias,
    data.atenciones?.resumen?.total,
    data.tiempoEspera?.resumen?.promedio_minutos,
    data.horasAgenda?.resumen?.agendadas,
    data.horasAgenda?.resumen?.utilizadas,
    data.demanda?.resumen?.total_solicitadas,
    data.detalle?.meta?.total,
  ]

  return totals.every((value) => Number(value ?? 0) === 0)
}
