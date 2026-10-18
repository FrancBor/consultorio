export function createAnalyticsService(repository) {
  return {
    async absence(filters) {
      const result = await repository.getAbsence(filters);
      return {
        resumen: {
          tasa: result.rate,
          total_agendadas: result.resolved,
          total_inasistencias: result.absences,
        },
        serie: result.series,
      };
    },

    async attendances(filters) {
      const result = await repository.getAttendances(filters);
      return { resumen: { total: result.total }, serie: result.series };
    },

    async waitTime(filters) {
      const result = await repository.getWaitTime(filters);
      return { resumen: { promedio_minutos: result.average }, serie: result.series };
    },

    async scheduleHours(filters) {
      const result = await repository.getScheduleHours(filters);
      return {
        resumen: {
          agendadas: result.scheduled,
          utilizadas: result.used,
          porcentaje_uso: result.usage,
        },
        serie: result.series,
      };
    },

    async demand(filters) {
      const result = await repository.getDemand(filters);
      return { resumen: { total_solicitadas: result.total }, serie: result.series };
    },

    async details(filters) {
      return repository.getDetails(filters);
    },
  };
}
