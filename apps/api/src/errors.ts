import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/** Every error leaves as `{ error: { code, message } }` (ErrorResponse in @conexa/shared). */
export function registerErrorHandlers(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply
        .code(400)
        .send({ error: { code: 'validation_error', message: err.message } });
    }
    if (err instanceof HttpError) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message } });
    }
    const { statusCode, code, message } = err as {
      statusCode?: number;
      code?: string;
      message?: string;
    };
    if (statusCode && statusCode < 500) {
      return reply.code(statusCode).send({
        error: { code: code ?? 'bad_request', message: message ?? '' },
      });
    }
    req.log.error(err);
    return reply
      .code(500)
      .send({ error: { code: 'internal', message: 'Internal Server Error' } });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: {
        code: 'not_found',
        message: `Route ${req.method} ${req.url} not found`,
      },
    })
  );
}
