export function notFound(_request, response) {
  response.status(404).json({
    error: {
      code: 'not_found',
      message: 'El recurso solicitado no existe.',
    },
  });
}
