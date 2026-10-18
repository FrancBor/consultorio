import { Router } from 'express';
import { HttpError } from '../../middleware/error-handler.js';
import { detailQuerySchema, indicatorQuerySchema } from './schemas.js';

function parseQuery(schema, query) {
  const result = schema.safeParse(query);

  if (!result.success) {
    throw new HttpError({
      status: 400,
      code: 'validation_error',
      message: 'Los filtros de consulta no son válidos.',
    });
  }

  return result.data;
}

function requireAnalyticsRole(request, _response, next) {
  if (!['admin', 'consulta'].includes(request.authUser?.rol)) {
    next(
      new HttpError({
        status: 403,
        code: 'forbidden',
        message: 'No tiene permisos para realizar esta acción.',
      }),
    );
    return;
  }

  next();
}

export function createAnalyticsRouter({ service, authenticationRequired }) {
  const router = Router();
  router.use(authenticationRequired, requireAnalyticsRole);

  const indicator = (method) => async (request, response) => {
    const filters = parseQuery(indicatorQuerySchema, request.query);
    const data = await service[method](filters);
    response.status(200).json({ data, meta: filters });
  };

  router.get('/indicadores/inasistencia', indicator('absence'));
  router.get('/indicadores/atenciones', indicator('attendances'));
  router.get('/indicadores/tiempo-espera', indicator('waitTime'));
  router.get('/indicadores/horas-agenda', indicator('scheduleHours'));
  router.get('/indicadores/demanda', indicator('demand'));
  router.get('/atenciones', async (request, response) => {
    const filters = parseQuery(detailQuerySchema, request.query);
    const result = await service.details(filters);
    response.status(200).json({
      data: { items: result.items },
      meta: {
        desde: filters.desde,
        hasta: filters.hasta,
        page: filters.page,
        limit: filters.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / filters.limit),
      },
    });
  });

  return router;
}

export { parseQuery, requireAnalyticsRole };
