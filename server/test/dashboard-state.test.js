import { describe, expect, it } from 'vitest';
import {
  createDashboardAttempt,
  isDashboardDataEmpty,
  retryDashboardAttempt,
} from '../../src/pages/dashboard-state.js';

function dashboardData(overrides = {}) {
  return {
    inasistencia: { resumen: { total_agendadas: 0 } },
    atenciones: { resumen: { total: 0 } },
    tiempoEspera: { resumen: { promedio_minutos: null } },
    horasAgenda: { resumen: { agendadas: 0 } },
    demanda: { resumen: { total_solicitadas: 0 } },
    detalle: { meta: { total: 0 } },
    ...overrides,
  };
}

describe('dashboard request state', () => {
  it('retries the exact failed filters and page without sharing editable state', () => {
    const editable = { desde: '2026-07-01', hasta: '2026-07-31' };
    const failedAttempt = createDashboardAttempt(editable, 4);
    editable.desde = '2026-08-01';

    const retry = retryDashboardAttempt(failedAttempt);

    expect(retry).toEqual({
      filters: { desde: '2026-07-01', hasta: '2026-07-31' },
      page: 4,
    });
    expect(retry).not.toBe(failedAttempt);
    expect(retry.filters).not.toBe(failedAttempt.filters);
  });

  it('does not report empty when detail contains appointments without demand', () => {
    expect(
      isDashboardDataEmpty(
        dashboardData({ detalle: { meta: { total: 3 } } }),
      ),
    ).toBe(false);
  });

  it('uses the complete KPI and detail set for the empty state', () => {
    expect(isDashboardDataEmpty(dashboardData())).toBe(true);
    expect(
      isDashboardDataEmpty(
        dashboardData({ horasAgenda: { resumen: { agendadas: 1 } } }),
      ),
    ).toBe(false);
    expect(
      isDashboardDataEmpty(
        dashboardData({ tiempoEspera: { resumen: { promedio_minutos: 12 } } }),
      ),
    ).toBe(false);
    expect(isDashboardDataEmpty(null)).toBe(false);
  });
});
