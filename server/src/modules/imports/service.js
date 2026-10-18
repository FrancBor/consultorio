import { basename } from 'node:path';
import { HttpError } from '../../middleware/error-handler.js';
import { ImportFileError, parseImportFile } from './parser.js';
import { ImportRepositoryError } from './repository.js';

function publicBatch(batch) {
  return {
    id: batch.id,
    formato: batch.formato,
    nombre_archivo: batch.nombre_archivo,
    cantidad_registros: Number(batch.cantidad_registros),
    cantidad_insertados: Number(batch.cantidad_insertados),
    cantidad_actualizados: Number(batch.cantidad_actualizados),
    cantidad_omitidos: Number(batch.cantidad_omitidos),
    importado_en: batch.importado_en,
    ...(batch.usuario === undefined
      ? {}
      : {
          usuario: batch.usuario,
          nombre_usuario: batch.nombre_usuario,
        }),
  };
}

function validationHttpError(error) {
  const status = {
    file_too_large: 413,
    unsupported_file: 415,
  }[error.code] ?? (error.errors?.length ? 422 : 400);
  return new HttpError({
    status,
    code: error.code,
    message: error.message,
    details: error.errors?.length
      ? { errores: error.errors, errores_truncados: error.truncated }
      : undefined,
  });
}

function safeFilename(value) {
  const name = basename(String(value ?? '').replaceAll('\\', '/')).trim();
  if (!name || name.length > 255 || /[\u0000-\u001F\u007F]/.test(name)) {
    throw new HttpError({
      status: 400,
      code: 'invalid_filename',
      message: 'El nombre del archivo no es válido.',
    });
  }
  return name;
}

export function createImportsService(repository) {
  return {
    async list(filters) {
      const result = await repository.list(filters);
      return { total: result.total, batches: result.batches.map(publicBatch) };
    },

    async detail(id) {
      const batch = await repository.findById(id);
      if (!batch) {
        throw new HttpError({
          status: 404,
          code: 'import_not_found',
          message: 'La importación solicitada no existe.',
        });
      }
      return publicBatch(batch);
    },

    async importFile({ file, actorId }) {
      if (!file) {
        throw new HttpError({
          status: 400,
          code: 'file_required',
          message: 'Debe seleccionar un archivo CSV o JSON.',
        });
      }

      let parsed;
      try {
        parsed = parseImportFile(file);
      } catch (error) {
        if (error instanceof ImportFileError) throw validationHttpError(error);
        throw error;
      }

      try {
        const result = await repository.import({
          ...parsed,
          filename: safeFilename(file.originalname),
          actorId,
        });
        return { batch: publicBatch(result.batch), repeated: result.repeated };
      } catch (error) {
        if (error instanceof ImportRepositoryError) {
          throw new HttpError({
            status: error.code === 'data_conflict' ? 409 : 422,
            code: error.code,
            message:
              error.code === 'data_conflict'
                ? 'Los datos existentes no son compatibles con la importación.'
                : 'El archivo contiene códigos inexistentes o inactivos.',
            details: {
              errores: error.details.errors,
              errores_truncados: error.details.truncated,
            },
          });
        }
        throw error;
      }
    },
  };
}

export { publicBatch };
