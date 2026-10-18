import { Router } from 'express';
import multer from 'multer';
import { HttpError } from '../../middleware/error-handler.js';
import { requireCsrf } from '../auth/csrf.js';
import { MAX_IMPORT_BYTES, detectImportFormat } from './parser.js';
import { importIdParamsSchema, listImportsQuerySchema } from './schemas.js';

function parseQuery(value) {
  const result = listImportsQuerySchema.safeParse(value);
  if (!result.success) {
    throw new HttpError({
      status: 400,
      code: 'validation_error',
      message: 'Los parámetros del historial no son válidos.',
    });
  }
  return result.data;
}

function parseParams(value) {
  const result = importIdParamsSchema.safeParse(value);
  if (!result.success) {
    throw new HttpError({
      status: 400,
      code: 'validation_error',
      message: 'El identificador de importación no es válido.',
    });
  }
  return result.data;
}

function uploadMiddleware() {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 0, parts: 1 },
    fileFilter(_request, file, callback) {
      if (detectImportFormat(file.originalname, file.mimetype)) callback(null, true);
      else {
        callback(
          new HttpError({
            status: 415,
            code: 'unsupported_file',
            message: 'Seleccione un archivo CSV o JSON válido.',
          }),
        );
      }
    },
  }).single('archivo');

  return (request, response, next) => {
    upload(request, response, (error) => {
      if (!error) return next();
      if (error instanceof HttpError) return next(error);
      if (error instanceof multer.MulterError) {
        const tooLarge = error.code === 'LIMIT_FILE_SIZE';
        return next(
          new HttpError({
            status: tooLarge ? 413 : 400,
            code: tooLarge ? 'file_too_large' : 'invalid_upload',
            message: tooLarge
              ? 'El archivo supera el máximo de 5 MiB.'
              : 'La carga multipart no es válida.',
          }),
        );
      }
      return next(error);
    });
  };
}

export function createImportsRouter({ service, authenticationRequired, adminRequired }) {
  const router = Router();
  router.use(authenticationRequired, adminRequired);

  router.get('/', async (request, response) => {
    const filters = parseQuery(request.query);
    const result = await service.list(filters);
    response.status(200).json({
      data: { importaciones: result.batches },
      meta: {
        page: filters.page,
        limit: filters.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / filters.limit),
      },
    });
  });

  router.get('/:id', async (request, response) => {
    const { id } = parseParams(request.params);
    const batch = await service.detail(id);
    response.status(200).json({ data: { importacion: batch } });
  });

  router.post('/', requireCsrf, uploadMiddleware(), async (request, response) => {
    const result = await service.importFile({ file: request.file, actorId: request.authUser.id });
    response.status(result.repeated ? 200 : 201).json({
      data: { importacion: result.batch },
      meta: { repetida: result.repeated },
    });
  });

  return router;
}

export { parseParams, parseQuery, uploadMiddleware };
