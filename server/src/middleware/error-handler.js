export class HttpError extends Error {
  constructor({ status, code, message, details, cause }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeError(error) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error?.type === 'entity.parse.failed') {
    return {
      status: 400,
      code: 'invalid_json',
      message: 'El cuerpo JSON no es válido.',
    };
  }

  if (error?.type === 'entity.too.large') {
    return {
      status: 413,
      code: 'payload_too_large',
      message: 'El cuerpo de la solicitud supera el límite permitido.',
    };
  }

  return {
    status: 500,
    code: 'internal_error',
    message: 'Ocurrió un error interno.',
  };
}

export function errorHandler(error, request, response, _next) {
  const normalized = normalizeError(error);
  const log = normalized.status >= 500 ? request.log?.error : request.log?.warn;

  log?.call(
    request.log,
    {
      errorCode: normalized.code,
      errorType: error?.name ?? 'Error',
      statusCode: normalized.status,
    },
    'Request failed',
  );

  response.status(normalized.status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details === undefined ? {} : { details: normalized.details }),
    },
  });
}
