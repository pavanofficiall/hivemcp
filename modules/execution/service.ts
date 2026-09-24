import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { Prisma, type Capability } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { appUrl } from '@/lib/config';
import { HiveError } from '@/lib/errors';
import { canonical, hash } from '@/modules/security/crypto';
import { sanitize, summary } from '@/modules/security/redact';
import { safeHttp, validateBaseUrl } from '@/modules/security/http';
import { applicationToken } from '@/modules/environments/oauth';
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
});
addFormats(ajv);
export const implementationSchema = z
  .object({
    httpMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
    route: z.string().startsWith('/api/'),
    supported: z.literal(true),
  })
  .passthrough();
export function assertExecutable(capability: Pick<Capability, 'status' | 'enabled' | 'policy'>) {
  if (!['APPROVED', 'VERIFIED'].includes(capability.status))
    throw new HiveError('CAPABILITY_NOT_APPROVED', 403);
  if (!capability.enabled || capability.policy === 'disabled')
    throw new HiveError('CAPABILITY_DISABLED', 403);
}
export function validateInput(schema: unknown, input: unknown) {
  if (JSON.stringify(input).length > 64000) throw new HiveError('VALIDATION_ERROR');
  const validate = ajv.compile(schema as object);
  if (!validate(input))
    throw new HiveError(
      'VALIDATION_ERROR',
      400,
      validate.errors?.map((e) => ({ path: e.instancePath, rule: e.keyword, message: e.message })),
    );
}
export function executionRequest(baseUrl: string, implementation: unknown, input: unknown) {
  const mapping = implementationSchema.parse(implementation);
  const values = z
    .object({
      path: z.record(z.string()).default({}),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
      body: z.unknown().optional(),
    })
    .strict()
    .parse(input);
  const path = mapping.route.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = values.path[name];
    if (!value || value === '.' || value === '..' || /[\/\\%?#\x00-\x1f]/.test(value))
      throw new HiveError('VALIDATION_ERROR');
    return encodeURIComponent(value);
  });
  if (/[{}\\?#]/.test(path) || path.includes('..') || !path.startsWith('/api/'))
    throw new HiveError('INVALID_EXECUTION_MAPPING');
  const origin = validateBaseUrl(baseUrl);
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new HiveError('INVALID_EXECUTION_MAPPING');
  for (const [key, value] of Object.entries(values.query)) url.searchParams.set(key, String(value));
  return {
    url,
    method: mapping.httpMethod,
    body: ['GET', 'HEAD'].includes(mapping.httpMethod)
      ? undefined
      : JSON.stringify(values.body ?? {}),
  };
}
export class CapabilityExecutionService {
  async execute(params: {
    userId: string;
    applicationId: string;
    name: string;
    input: unknown;
    client: string;
    confirmationId?: string;
  }) {
    const started = Date.now();
    const application = await db.application.findUnique({ where: { id: params.applicationId } });
    if (!application) throw new HiveError('APPLICATION_NOT_FOUND', 404);
    const log = await db.executionLog.create({
      data: {
        userId: params.userId,
        applicationId: application.id,
        capabilityName: params.name,
        client: params.client.slice(0, 100),
        status: 'STARTED',
        duration: 0,
        inputSummary: summary(params.input) as Prisma.InputJsonValue,
        resultSummary: {},
      },
    });
    let cap: Capability | null = null;
    try {
      if (application.userId !== params.userId)
        throw new HiveError('APPLICATION_ACCESS_DENIED', 403);
      if (!application.enabled) throw new HiveError('APPLICATION_DISABLED', 403);
      cap = await db.capability.findUnique({
        where: { applicationId_name: { applicationId: application.id, name: params.name } },
      });
      if (!cap) throw new HiveError('CAPABILITY_NOT_FOUND', 404);
      assertExecutable(cap);
      validateInput(cap.inputSchema, params.input);
      const environment = await db.applicationEnvironment.findUnique({
        where: { applicationId: application.id },
      });
      if (!environment) throw new HiveError('APPLICATION_NOT_CONNECTED');
      const token = await applicationToken(environment.id, params.userId);
      const request = executionRequest(environment.baseUrl, cap.implementation, params.input);
      const inputHash = hash(canonical(params.input));
      const requiresConfirmation =
        cap.policy === 'confirmation_required' ||
        (params.client === 'playground' && !['GET', 'HEAD'].includes(request.method));
      if (requiresConfirmation) {
        if (!params.confirmationId) {
          const confirmation = await db.confirmation.create({
            data: {
              userId: params.userId,
              applicationId: application.id,
              capabilityId: cap.id,
              fingerprint: cap.fingerprint,
              inputHash,
              input: params.input as Prisma.InputJsonValue,
              expiresAt: new Date(Date.now() + 600000),
            },
          });
          throw new HiveError('CONFIRMATION_REQUIRED', 409, {
            confirmationId: confirmation.id,
            approvalUrl: `${appUrl()}/apps/${application.id}/agent-playground?confirmation=${confirmation.id}`,
          });
        }
        const consumed = await db.confirmation.updateMany({
          where: {
            id: params.confirmationId,
            userId: params.userId,
            applicationId: application.id,
            capabilityId: cap.id,
            fingerprint: cap.fingerprint,
            inputHash,
            approvedAt: { not: null },
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { consumedAt: new Date() },
        });
        if (consumed.count !== 1) throw new HiveError('INVALID_CONFIRMATION', 403);
      }
      // Recheck the registry immediately before crossing the application boundary.
      const current = await db.capability.findUniqueOrThrow({ where: { id: cap.id } });
      assertExecutable(current);
      if (current.fingerprint !== cap.fingerprint || current.policy !== cap.policy)
        throw new HiveError('CAPABILITY_CHANGED', 409);
      await db.executionLog.update({
        where: { id: log.id },
        data: {
          capabilityId: cap.id,
          environmentId: environment.id,
          policy: cap.policy,
          status: 'DISPATCHED',
        },
      });
      const result = await safeHttp(request.url, {
        method: request.method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: request.body,
      });
      if (result.status === 403) throw new HiveError('INSUFFICIENT_PERMISSION', 403);
      if (result.status === 401) throw new HiveError('APPLICATION_REAUTHORIZATION_REQUIRED', 401);
      if (result.status < 200 || result.status >= 300)
        throw new HiveError('APPLICATION_REJECTED_REQUEST', 422, { status: result.status });
      const data = sanitize(result.data);
      const duration = Date.now() - started;
      await db.$transaction([
        db.executionLog.update({
          where: { id: log.id },
          data: {
            status: 'SUCCEEDED',
            duration,
            resultSummary: summary(data) as Prisma.InputJsonValue,
          },
        }),
        db.capability.updateMany({
          where: {
            id: cap.id,
            fingerprint: cap.fingerprint,
            status: { in: ['APPROVED', 'VERIFIED'] },
            enabled: true,
          },
          data: { status: 'VERIFIED', verifiedAt: new Date() },
        }),
      ]);
      return { executionId: log.id, status: result.status, duration, data };
    } catch (error) {
      const failure =
        error instanceof HiveError ? error : new HiveError('INTERNAL_EXECUTION_ERROR', 500);
      await db.executionLog.update({
        where: { id: log.id },
        data: {
          status: failure.code === 'CONFIRMATION_REQUIRED' ? 'AWAITING_CONFIRMATION' : 'FAILED',
          capabilityId: cap?.id,
          policy: cap?.policy,
          errorCode: failure.code,
          duration: Date.now() - started,
        },
      });
      throw failure;
    }
  }
}
