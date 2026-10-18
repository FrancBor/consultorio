// Referencia histórica del prototipo. El dashboard real no importa este archivo:
// sus indicadores y detalle provienen de la API PostgreSQL mediante client.js.

const PERIODOS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']

export const mockInasistencia = {
  resumen: { tasa: 0.17, total_agendadas: 1840, total_inasistencias: 313 },
  serie: [
    { periodo: PERIODOS[0], valor: 0.19 },
    { periodo: PERIODOS[1], valor: 0.21 },
    { periodo: PERIODOS[2], valor: 0.18 },
    { periodo: PERIODOS[3], valor: 0.15 },
    { periodo: PERIODOS[4], valor: 0.14 },
    { periodo: PERIODOS[5], valor: 0.17 },
  ],
}

export const mockAtenciones = {
  resumen: { total: 1527 },
  serie: [
    { periodo: PERIODOS[0], valor: 231 },
    { periodo: PERIODOS[1], valor: 224 },
    { periodo: PERIODOS[2], valor: 248 },
    { periodo: PERIODOS[3], valor: 266 },
    { periodo: PERIODOS[4], valor: 279 },
    { periodo: PERIODOS[5], valor: 279 },
  ],
}

export const mockTiempoEspera = {
  resumen: { promedio_minutos: 23.4 },
  serie: [
    { periodo: PERIODOS[0], valor: 27.1 },
    { periodo: PERIODOS[1], valor: 29.4 },
    { periodo: PERIODOS[2], valor: 24.8 },
    { periodo: PERIODOS[3], valor: 21.2 },
    { periodo: PERIODOS[4], valor: 19.6 },
    { periodo: PERIODOS[5], valor: 18.3 },
  ],
}

export const mockHorasAgenda = {
  resumen: { agendadas: 1840, utilizadas: 1527, porcentaje_uso: 83 },
  serie: [
    { periodo: PERIODOS[0], agendadas: 305, utilizadas: 231 },
    { periodo: PERIODOS[1], agendadas: 298, utilizadas: 224 },
    { periodo: PERIODOS[2], agendadas: 312, utilizadas: 248 },
    { periodo: PERIODOS[3], agendadas: 306, utilizadas: 266 },
    { periodo: PERIODOS[4], agendadas: 315, utilizadas: 279 },
    { periodo: PERIODOS[5], agendadas: 304, utilizadas: 279 },
  ],
}

export const mockDemanda = {
  resumen: { total_solicitadas: 1840 },
  serie: [
    { periodo: PERIODOS[0], valor: 305 },
    { periodo: PERIODOS[1], valor: 298 },
    { periodo: PERIODOS[2], valor: 312 },
    { periodo: PERIODOS[3], valor: 306 },
    { periodo: PERIODOS[4], valor: 315 },
    { periodo: PERIODOS[5], valor: 304 },
  ],
}

export const mockDetalle = [
  { fecha: '2026-09-08', hora_agendada: '08:30', tipo_atencion: 'Medicina General', asistio: true, tiempo_espera_minutos: 14 },
  { fecha: '2026-09-08', hora_agendada: '09:00', tipo_atencion: 'Control Cronico', asistio: false, tiempo_espera_minutos: null },
  { fecha: '2026-09-08', hora_agendada: '09:30', tipo_atencion: 'Enfermeria', asistio: true, tiempo_espera_minutos: 22 },
  { fecha: '2026-09-09', hora_agendada: '10:00', tipo_atencion: 'Odontologia', asistio: true, tiempo_espera_minutos: 31 },
  { fecha: '2026-09-09', hora_agendada: '10:30', tipo_atencion: 'Control de Salud', asistio: true, tiempo_espera_minutos: 9 },
  { fecha: '2026-09-09', hora_agendada: '11:00', tipo_atencion: 'Medicina General', asistio: false, tiempo_espera_minutos: null },
]
