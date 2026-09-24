import { ZodError } from 'zod';
export class HiveError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(code);
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof HiveError)
    return Response.json({ error: error.code, details: error.details }, { status: error.status });
  if (error instanceof ZodError)
    return Response.json(
      {
        error: 'VALIDATION_ERROR',
        fields: error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      { status: 400 },
    );
  if (error instanceof Error && error.message.startsWith('CONFIGURATION_REQUIRED:'))
    return Response.json(
      { error: 'CONFIGURATION_REQUIRED', variable: error.message.split(':')[1] },
      { status: 503 },
    );
  return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
}
export function api<T extends unknown[]>(handler: (...args: T) => Promise<Response>) {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
