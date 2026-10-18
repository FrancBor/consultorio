import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAnalyticsRouter } from '../src/modules/analytics/routes.js';
import { createAnalyticsRepository } from '../src/modules/analytics/repository.js';
import { createAnalyticsService } from '../src/modules/analytics/service.js';
import { detailQuerySchema, indicatorQuerySchema } from '../src/modules/analytics/schemas.js';
import { errorHandler, HttpError } from '../src/middleware/error-handler.js';

const filters = { desde: '2026-04-01', hasta: '2026-09-30' };

describe('analytics filter validation', () => {
  it('accepts an inclusive range up to 366 days and detail defaults', () => {
    expect(indicatorQuerySchema.parse({ desde: '2024-01-01', hasta: '2024-12-31' })).toEqual({
      desde: '2024-01-01',
      hasta: '2024-12-31',
    });
    expect(detailQuerySchema.parse(filters)).toEqual({ ...filters, page: 1, limit: 25 });
  });

  it.each([
    { desde: '2026-09-30', hasta: '2026-04-01' },
    { desde: '2025-01-01', hasta: '2026-01-02' },
    { desde: '2026-02-30', hasta: '2026-03-01' },
    { ...filters, extra: 'not-supported' },
  ])('rejects invalid or unknown filters: %o', (query) => {
    expect(indicatorQuerySchema.safeParse(query).success).toBe(false);
  });

  it('bounds pagination', () => {
    expect(detailQuerySchema.safeParse({ ...filters, page: '0' }).success).toBe(false);
    expect(detailQuerySchema.safeParse({ ...filters, limit: '101' }).success).toBe(false);
    expect(detailQuerySchema.safeParse({ ...filters, page: ['1', '2'] }).success).toBe(false);
  });
});

describe('analytics repository queries', () => {
  it('uses parameterized date bounds, generated months, and safe pagination values', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ total: 0, series: [] }] })
        .mockResolvedValueOnce({ rows: [{ total: 40, id: null }] }),
    };
    const repository = createAnalyticsRepository(pool);

    await repository.getDemand(filters);
    expect(pool.query.mock.calls[0][0]).toContain('generate_series');
    expect(pool.query.mock.calls[0][0]).toContain("AT TIME ZONE 'America/Santiago'");
    expect(pool.query.mock.calls[0][1]).toEqual(['2026-04-01', '2026-09-30']);

    await expect(repository.getDetails({ ...filters, page: 2, limit: 25 })).resolves.toEqual({
      total: 40,
      items: [],
    });
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[1][1]).toEqual(['2026-04-01', '2026-09-30', 25, 25]);
    expect(pool.query.mock.calls[1][0]).toContain('count(*) OVER()');
    expect(pool.query.mock.calls[1][0]).toContain('ORDER BY sort_at, id');
  });
});

describe('analytics service contracts', () => {
  it('maps canonical formula results without averaging monthly averages', async () => {
    const repository = {
      getAbsence: vi.fn().mockResolvedValue({
        rate: 313 / 1840,
        resolved: 1840,
        absences: 313,
        series: [{ periodo: '2026-04', valor: 74 / 305 }],
      }),
      getAttendances: vi.fn().mockResolvedValue({ total: 1527, series: [] }),
      getWaitTime: vi.fn().mockResolvedValue({ average: 23.1, series: [] }),
      getScheduleHours: vi.fn().mockResolvedValue({
        scheduled: 1840,
        used: 1527,
        usage: 1527 / 1840,
        series: [],
      }),
      getDemand: vi.fn().mockResolvedValue({ total: 1840, series: [] }),
    };
    const service = createAnalyticsService(repository);

    await expect(service.absence(filters)).resolves.toMatchObject({
      resumen: { total_agendadas: 1840, total_inasistencias: 313 },
    });
    await expect(service.attendances(filters)).resolves.toEqual({
      resumen: { total: 1527 },
      serie: [],
    });
    await expect(service.waitTime(filters)).resolves.toEqual({
      resumen: { promedio_minutos: 23.1 },
      serie: [],
    });
    await expect(service.scheduleHours(filters)).resolves.toMatchObject({
      resumen: { agendadas: 1840, utilizadas: 1527, porcentaje_uso: 1527 / 1840 },
    });
    await expect(service.demand(filters)).resolves.toEqual({
      resumen: { total_solicitadas: 1840 },
      serie: [],
    });
  });
});

function buildRouterApp({ role = 'consulta', authenticated = true } = {}) {
  const service = {
    absence: vi.fn().mockResolvedValue({ resumen: { tasa: null }, serie: [] }),
    attendances: vi.fn().mockResolvedValue({ resumen: { total: 0 }, serie: [] }),
    waitTime: vi.fn().mockResolvedValue({ resumen: { promedio_minutos: null }, serie: [] }),
    scheduleHours: vi.fn().mockResolvedValue({
      resumen: { agendadas: 0, utilizadas: 0, porcentaje_uso: null },
      serie: [],
    }),
    demand: vi.fn().mockResolvedValue({ resumen: { total_solicitadas: 0 }, serie: [] }),
    details: vi.fn().mockResolvedValue({
      total: 5,
      items: [
        { id: '1', estado: 'atendida', tiempo_espera_minutos: 12 },
        { id: '2', estado: 'inasistencia', tiempo_espera_minutos: null },
        { id: '3', estado: 'agendada', tiempo_espera_minutos: null },
        { id: '4', estado: 'confirmada', tiempo_espera_minutos: null },
        { id: '5', estado: 'cancelada', tiempo_espera_minutos: null },
      ],
    }),
  };
  const authenticationRequired = (request_, _response, next) => {
    if (!authenticated) {
      next(
        new HttpError({
          status: 401,
          code: 'authentication_required',
          message: 'Debe iniciar sesión para continuar.',
        }),
      );
      return;
    }
    request_.authUser = { rol: role };
    next();
  };
  const app = express();
  app.use('/api/v1', createAnalyticsRouter({ service, authenticationRequired }));
  app.use(errorHandler);
  return { app, service };
}

describe('analytics routes', () => {
  it('requires authentication', async () => {
    const { app } = buildRouterApp({ authenticated: false });
    const response = await request(app)
      .get('/api/v1/indicadores/demanda')
      .query(filters)
      .expect(401);
    expect(response.body.error.code).toBe('authentication_required');
  });

  it.each(['admin', 'consulta'])('allows the canonical %s role', async (role) => {
    const { app } = buildRouterApp({ role });
    await request(app).get('/api/v1/indicadores/demanda').query(filters).expect(200);
  });

  it('rejects unsupported roles and unknown query parameters', async () => {
    const forbidden = buildRouterApp({ role: 'other' });
    await request(forbidden.app).get('/api/v1/indicadores/demanda').query(filters).expect(403);

    const { app } = buildRouterApp();
    await request(app)
      .get('/api/v1/indicadores/demanda')
      .query({ ...filters, unknown: 'value' })
      .expect(400);
  });

  it('returns uniform shapes for all indicator and detail routes', async () => {
    const { app } = buildRouterApp();
    for (const path of [
      'inasistencia',
      'atenciones',
      'tiempo-espera',
      'horas-agenda',
      'demanda',
    ]) {
      const response = await request(app)
        .get(`/api/v1/indicadores/${path}`)
        .query(filters)
        .expect(200);
      expect(response.body).toHaveProperty('data.resumen');
      expect(response.body).toHaveProperty('data.serie');
      expect(response.body.meta).toEqual(filters);
    }

    const detail = await request(app).get('/api/v1/atenciones').query(filters).expect(200);
    expect(detail.body.data.items.map((item) => item.estado)).toEqual([
      'atendida',
      'inasistencia',
      'agendada',
      'confirmada',
      'cancelada',
    ]);
    expect(detail.body.data.items.slice(1).every((item) => item.tiempo_espera_minutos === null)).toBe(true);
    expect(detail.body.meta).toEqual({ ...filters, page: 1, limit: 25, total: 5, totalPages: 1 });
  });
});
