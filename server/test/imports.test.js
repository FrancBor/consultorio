import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler, HttpError } from '../src/middleware/error-handler.js';
import {
  IMPORT_COLUMNS,
  IMPORT_SOURCE,
  ImportFileError,
  parseImportFile,
} from '../src/modules/imports/parser.js';
import { ImportRepositoryError } from '../src/modules/imports/repository.js';
import { createImportsRouter } from '../src/modules/imports/routes.js';
import { importIdParamsSchema, listImportsQuerySchema } from '../src/modules/imports/schemas.js';
import { createImportsService } from '../src/modules/imports/service.js';

function validRecord(overrides = {}) {
  return {
    clave_origen: 'manual-0001',
    tipo_atencion_codigo: 'medicina_general',
    estado_solicitud_codigo: 'cerrada',
    unidad_codigo: null,
    solicitada_en: '2026-10-01T09:00:00-03:00',
    cerrada_en: '2026-10-02T10:30:00-03:00',
    estado_cita_codigo: 'atendida',
    inicio_agendado_en: '2026-10-02T10:00:00-03:00',
    llegada_en: '2026-10-02T09:50:00-03:00',
    inicio_atencion_en: '2026-10-02T10:05:00-03:00',
    fin_atencion_en: '2026-10-02T10:30:00-03:00',
    duracion_espera_reportada_minutos: null,
    ...overrides,
  };
}

function jsonFile(records, overrides = {}) {
  const buffer = Buffer.from(JSON.stringify(records));
  return {
    buffer,
    originalname: 'datos.json',
    mimetype: 'application/json',
    ...overrides,
  };
}

function batch(overrides = {}) {
  return {
    id: '7',
    formato: 'json',
    nombre_archivo: 'datos.json',
    cantidad_registros: 1,
    cantidad_insertados: 1,
    cantidad_actualizados: 0,
    cantidad_omitidos: 0,
    importado_en: '2026-10-17T12:00:00.000Z',
    ...overrides,
  };
}

describe('import parser', () => {
  it('normalizes a strict JSON row and computes a stable hash', () => {
    const parsed = parseImportFile(
      jsonFile([
        validRecord({
          tipo_atencion_codigo: 'MEDICINA_GENERAL',
          unidad_codigo: undefined,
        }),
      ]),
    );

    expect(parsed.format).toBe('json');
    expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.records).toEqual([
      expect.objectContaining({
        record_number: 1,
        clave_origen: 'manual-0001',
        tipo_atencion_codigo: 'medicina_general',
        unidad_codigo: null,
        solicitada_en: '2026-10-01T12:00:00.000Z',
      }),
    ]);
  });

  it('accepts the exact CSV header and maps optional empty fields to null', () => {
    const values = validRecord({
      clave_origen: 'manual-0002',
      estado_solicitud_codigo: 'agendada',
      cerrada_en: '',
      estado_cita_codigo: 'confirmada',
      llegada_en: '',
      inicio_atencion_en: '',
      fin_atencion_en: '',
      duracion_espera_reportada_minutos: '',
    });
    const csv = `${IMPORT_COLUMNS.join(',')}\n${IMPORT_COLUMNS.map((field) => values[field] ?? '').join(',')}`;
    const parsed = parseImportFile({
      buffer: Buffer.from(csv),
      originalname: 'datos.csv',
      mimetype: 'text/csv',
    });

    expect(parsed.records[0]).toMatchObject({
      clave_origen: 'manual-0002',
      cerrada_en: null,
      inicio_atencion_en: null,
    });
  });

  it.each([
    [
      'unknown fields',
      [validRecord({ nombre_persona: 'No permitido' })],
      'campo_desconocido',
    ],
    [
      'duplicate keys',
      [validRecord(), validRecord()],
      'clave_duplicada',
    ],
    [
      'attention data on a missed appointment',
      [validRecord({ estado_cita_codigo: 'inasistencia' })],
      'estado_incoherente',
    ],
  ])('rejects %s after collecting safe validation errors', (_case, records, code) => {
    try {
      parseImportFile(jsonFile(records));
      throw new Error('Expected parser failure.');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportFileError);
      expect(error.errors).toEqual(expect.arrayContaining([expect.objectContaining({ codigo: code })]));
      expect(JSON.stringify(error.errors)).not.toContain('No permitido');
      if (code === 'campo_desconocido') {
        expect(error.errors[0].campo).toBeNull();
        expect(JSON.stringify(error.errors)).not.toContain('nombre_persona');
      }
    }
  });

  it('rejects malformed UTF-8 and MIME/extension mismatches', () => {
    expect(() =>
      parseImportFile(
        jsonFile([], { buffer: Buffer.from([0xc3, 0x28]) }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid_encoding' }));
    expect(() =>
      parseImportFile(jsonFile([validRecord()], { originalname: 'datos.csv' })),
    ).toThrowError(expect.objectContaining({ code: 'unsupported_file' }));
  });

  it('rejects calendar-normalized dates and bounds returned validation errors', () => {
    expect(() =>
      parseImportFile(
        jsonFile([validRecord({ solicitada_en: '2026-02-30T10:00:00-03:00' })]),
      ),
    ).toThrowError(
      expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({ campo: 'solicitada_en', codigo: 'valor_invalido' }),
        ]),
      }),
    );

    try {
      parseImportFile(jsonFile(Array.from({ length: 102 }, () => validRecord())));
      throw new Error('Expected parser failure.');
    } catch (error) {
      expect(error.errors).toHaveLength(100);
      expect(error.truncated).toBe(true);
    }
  });

  it('rejects the legacy entity envelope and configurable source fields', () => {
    expect(() =>
      parseImportFile(
        jsonFile({
          version_contrato: '1.0',
          lote_sistema_origen: 'externo',
          registros: [validRecord()],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid_format' }));
    expect(IMPORT_SOURCE).toBe('carga_manual_v1');
  });
});

describe('import schemas and service', () => {
  it('parses bounded history pagination strictly', () => {
    expect(listImportsQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(listImportsQuerySchema.parse({ page: '2', limit: '100' })).toEqual({
      page: 2,
      limit: 100,
    });
    expect(listImportsQuerySchema.safeParse({ extra: 'true' }).success).toBe(false);
    expect(importIdParamsSchema.parse({ id: '9223372036854775807' })).toEqual({
      id: '9223372036854775807',
    });
    expect(importIdParamsSchema.safeParse({ id: '0' }).success).toBe(false);
    expect(importIdParamsSchema.safeParse({ id: '9223372036854775808' }).success).toBe(false);
  });

  it('forwards only normalized rows and a safe basename to the repository', async () => {
    const repository = {
      import: vi.fn().mockResolvedValue({ batch: batch(), repeated: false }),
    };
    const service = createImportsService(repository);
    await expect(
      service.importFile({
        file: jsonFile([validRecord()], { originalname: '../datos.json' }),
        actorId: '3',
      }),
    ).resolves.toEqual({ batch: batch(), repeated: false });
    expect(repository.import).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'datos.json', actorId: '3', format: 'json' }),
    );
  });

  it('maps catalog validation failures to a safe 422 response error', async () => {
    const repository = {
      import: vi.fn().mockRejectedValue(
        new ImportRepositoryError('validation_error', {
          errors: [
            {
              codigo: 'catalogo_no_encontrado',
              registro: 1,
              campo: 'tipo_atencion_codigo',
              mensaje: 'El código no existe o no está activo.',
            },
          ],
          truncated: false,
        }),
      ),
    };
    const service = createImportsService(repository);
    await expect(
      service.importFile({ file: jsonFile([validRecord()]), actorId: '3' }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'validation_error',
      details: { errores_truncados: false },
    });
  });

  it('returns only public detail and maps missing or external batches to a safe 404', async () => {
    const repository = {
      findById: vi
        .fn()
        .mockResolvedValueOnce({
          ...batch(),
          hash_contenido_sha256: 'secret-hash',
          clave_origen: 'secret-key',
          usuario: 'admin',
          nombre_usuario: 'Administrador',
        })
        .mockResolvedValueOnce(null),
    };
    const service = createImportsService(repository);
    const detail = await service.detail('7');
    expect(detail).toEqual({
      ...batch(),
      usuario: 'admin',
      nombre_usuario: 'Administrador',
    });
    expect(detail).not.toHaveProperty('hash_contenido_sha256');
    expect(detail).not.toHaveProperty('clave_origen');
    await expect(service.detail('8')).rejects.toMatchObject({
      status: 404,
      code: 'import_not_found',
    });
  });
});

function buildRouterApp() {
  const service = {
    list: vi.fn().mockResolvedValue({ total: 1, batches: [batch()] }),
    detail: vi.fn().mockResolvedValue(batch()),
    importFile: vi.fn().mockResolvedValue({ batch: batch(), repeated: false }),
  };
  const app = express();
  app.use((request_, _response, next) => {
    request_.session = { csrfToken: 'valid-token' };
    next();
  });
  app.use(
    '/api/v1/admin/importaciones',
    createImportsRouter({
      service,
      authenticationRequired(request_, _response, next) {
        request_.authUser = { id: '3', rol: 'admin' };
        next();
      },
      adminRequired: (_request, _response, next) => next(),
    }),
  );
  app.use(errorHandler);
  return { app, service };
}

describe('import routes', () => {
  it('returns paginated history and rejects unknown query parameters', async () => {
    const context = buildRouterApp();
    const response = await request(context.app)
      .get('/api/v1/admin/importaciones?page=1&limit=20')
      .expect(200);
    expect(response.body).toEqual({
      data: { importaciones: [batch()] },
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    await request(context.app).get('/api/v1/admin/importaciones?unknown=true').expect(400);
  });

  it('returns a validated public detail envelope and a safe 404', async () => {
    const context = buildRouterApp();
    const response = await request(context.app)
      .get('/api/v1/admin/importaciones/7')
      .expect(200);
    expect(response.body).toEqual({ data: { importacion: batch() } });
    expect(context.service.detail).toHaveBeenCalledWith('7');

    await request(context.app).get('/api/v1/admin/importaciones/not-an-id').expect(400);
    context.service.detail.mockRejectedValueOnce(
      new HttpError({
        status: 404,
        code: 'import_not_found',
        message: 'La importación solicitada no existe.',
      }),
    );
    const missing = await request(context.app).get('/api/v1/admin/importaciones/8').expect(404);
    expect(missing.body).toEqual({
      error: {
        code: 'import_not_found',
        message: 'La importación solicitada no existe.',
      },
    });
  });

  it('requires CSRF before accepting one bounded multipart file', async () => {
    const context = buildRouterApp();
    const body = Buffer.from(JSON.stringify([validRecord()]));
    await request(context.app)
      .post('/api/v1/admin/importaciones')
      .attach('archivo', body, { filename: 'datos.json', contentType: 'application/json' })
      .expect(403);

    const response = await request(context.app)
      .post('/api/v1/admin/importaciones')
      .set('X-CSRF-Token', 'valid-token')
      .attach('archivo', body, { filename: 'datos.json', contentType: 'application/json' })
      .expect(201);
    expect(response.body.meta).toEqual({ repetida: false });
    expect(context.service.importFile).toHaveBeenCalledWith({
      file: expect.objectContaining({ originalname: 'datos.json', size: body.length }),
      actorId: '3',
    });
  });

  it('rejects unexpected multipart fields without leaking parser details', async () => {
    const context = buildRouterApp();
    const response = await request(context.app)
      .post('/api/v1/admin/importaciones')
      .set('X-CSRF-Token', 'valid-token')
      .field('source', 'untrusted')
      .attach('archivo', Buffer.from('{}'), {
        filename: 'datos.json',
        contentType: 'application/json',
      })
      .expect(400);
    expect(response.body).toEqual({
      error: { code: 'invalid_upload', message: 'La carga multipart no es válida.' },
    });
    expect(context.service.importFile).not.toHaveBeenCalled();
  });

  it('uses 415 for unsupported file media while preserving 400 for multipart shape', async () => {
    const context = buildRouterApp();
    const response = await request(context.app)
      .post('/api/v1/admin/importaciones')
      .set('X-CSRF-Token', 'valid-token')
      .attach('archivo', Buffer.from('not supported'), {
        filename: 'datos.txt',
        contentType: 'text/plain',
      })
      .expect(415);
    expect(response.body).toEqual({
      error: { code: 'unsupported_file', message: 'Seleccione un archivo CSV o JSON válido.' },
    });
  });
});
