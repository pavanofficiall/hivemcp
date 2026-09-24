import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { api, HiveError } from '@/lib/errors';
import { appUrl, configured, githubKeys } from '@/lib/config';
import { requireUser, createSession, logout, checkOrigin, ownedApp } from '@/modules/auth/session';
import { passwordHash, verifyPassword, encrypt, hash } from '@/modules/security/crypto';
import { summary } from '@/modules/security/redact';
import { githubStart, githubCallback } from '@/modules/github/oauth';
import { accessibleRepositories } from '@/modules/github/client';
import { webhook } from '@/modules/github/webhook';
import { analysisQueue, rateLimit } from '@/modules/jobs/queue';
import { validateBaseUrl } from '@/modules/security/http';
import { beginApplicationOAuth, finishApplicationOAuth } from '@/modules/environments/oauth';
import { authorize, exchangeToken, redirectUri } from '@/modules/oauth/agent';
import { runPlayground, withMcp } from '@/modules/mcp/playground';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const authInput = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
  name: z.string().min(1).max(80).optional(),
});
async function body(request: Request) {
  const text = await request.text();
  if (text.length > 80000) throw new HiveError('REQUEST_TOO_LARGE', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new HiveError('INVALID_JSON');
  }
}
const handle = api(async (request: Request, context: { params: Promise<{ path: string[] }> }) => {
  const parts = (await context.params).path;
  const route = parts.join('/');
  const method = request.method;
  const url = new URL(request.url);
  if (route === 'health') {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: 'ok', service: 'hive' });
  }
  if (route === 'github/webhook' && method === 'POST') return webhook(request);
  if (route === 'oauth/token' && method === 'POST') {
    if (!(await rateLimit('oauth-token', 120))) throw new HiveError('RATE_LIMITED', 429);
    const input = await request.text();
    if (input.length > 10000) throw new HiveError('REQUEST_TOO_LARGE', 413);
    return Response.json(await exchangeToken(Object.fromEntries(new URLSearchParams(input))), {
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    });
  }
  if (route === 'oauth/revoke' && method === 'POST') {
    const input = await request.text();
    if (input.length > 10000) throw new HiveError('REQUEST_TOO_LARGE', 413);
    const form = Object.fromEntries(new URLSearchParams(input));
    if (form.token)
      await db.agentToken.updateMany({
        where: {
          clientId: form.client_id ?? '',
          OR: [{ accessHash: hash(form.token) }, { refreshHash: hash(form.token) }],
        },
        data: { revokedAt: new Date() },
      });
    return Response.json({});
  }
  if (method !== 'GET') checkOrigin(request);
  if (['auth/register', 'auth/login'].includes(route) && method === 'POST') {
    const input = authInput.parse(await body(request));
    if (
      !(await rateLimit(`auth:${hash(input.email)}`, 10, 600)) ||
      !(await rateLimit('auth-global', 100, 600))
    )
      throw new HiveError('RATE_LIMITED', 429);
    let user = await db.user.findUnique({ where: { email: input.email } });
    if (route === 'auth/register') {
      if (user) throw new HiveError('ACCOUNT_ALREADY_EXISTS', 409);
      user = await db.user.create({
        data: {
          email: input.email,
          name: input.name ?? input.email.split('@')[0],
          passwordHash: passwordHash(input.password),
        },
      });
    } else if (!user || !verifyPassword(input.password, user.passwordHash))
      throw new HiveError('INVALID_CREDENTIALS', 401);
    await createSession(user.id);
    return Response.json({ ok: true });
  }
  const user = await requireUser();
  if (route === 'auth/logout' && method === 'POST') {
    await logout();
    return Response.json({ ok: true });
  }
  if (route === 'settings' && method === 'GET') {
    const github = await db.gitHubConnection.findUnique({
      where: { userId: user.id },
      select: { login: true, expiresAt: true },
    });
    return Response.json({
      user: { name: user.name, email: user.email },
      github,
      configuration: {
        github: configured(githubKeys),
        gemini: configured(['GEMINI_API_KEY', 'GEMINI_ANALYSIS_MODEL']),
        database: configured(['DATABASE_URL']),
        redis: configured(['REDIS_URL']),
      },
      appUrl: appUrl(),
    });
  }
  if (route === 'github/start' && method === 'POST')
    return Response.json({ url: await githubStart(user.id) });
  if (route === 'github/callback' && method === 'GET')
    return Response.redirect(await githubCallback(url.searchParams, user.id));
  if (route === 'github/repositories' && method === 'GET')
    return Response.json(await accessibleRepositories(user.id));
  if (route === 'oauth/application/callback' && method === 'GET') {
    const appId = await finishApplicationOAuth(
      url.searchParams.get('code') ?? '',
      url.searchParams.get('state') ?? '',
      user.id,
    );
    return Response.redirect(`${appUrl()}/apps/${appId}/connections`);
  }
  if (route === 'oauth/authorize' && method === 'POST') {
    const form = Object.fromEntries(await request.formData());
    if (form.approve !== 'yes') throw new HiveError('CONSENT_REQUIRED', 403);
    return Response.redirect(await authorize(form, user.id), 303);
  }
  if (route === 'applications' && method === 'GET')
    return Response.json(
      await db.application.findMany({
        where: { userId: user.id },
        include: {
          _count: { select: { capabilities: true } },
          runs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, progress: true, stage: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  if (route === 'applications' && method === 'POST') {
    const input = z
      .object({
        repositoryId: z.number().int(),
        name: z.string().min(2).max(80),
        slug: z.string().regex(/^[a-z][a-z0-9-]{2,59}$/),
      })
      .parse(await body(request));
    const repositories = await accessibleRepositories(user.id);
    const repo = repositories.find((r) => r.id === input.repositoryId);
    if (!repo) throw new HiveError('GITHUB_ACCESS_DENIED', 403);
    try {
      return Response.json(
        await db.application.create({
          data: {
            name: input.name,
            slug: input.slug,
            userId: user.id,
            repositoryId: repo.id,
            installationId: repo.installationId,
            repositoryOwner: repo.owner.login,
            repositoryName: repo.name,
            defaultBranch: repo.default_branch,
          },
        }),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new HiveError('APPLICATION_ALREADY_EXISTS', 409);
      throw error;
    }
  }
  if (route === 'activity' && method === 'GET')
    return Response.json(
      await db.executionLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  if (parts[0] === 'apps' && parts[1]) {
    const app = await ownedApp(parts[1], user.id);
    const action = parts[2];
    if (!action && method === 'GET') {
      const [run, capabilities, environment, logs, clients, confirmations] = await Promise.all([
        db.analysisRun.findFirst({
          where: { applicationId: app.id },
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { nodes: true, edges: true } } },
        }),
        db.capability.findMany({ where: { applicationId: app.id }, orderBy: { name: 'asc' } }),
        db.applicationEnvironment.findUnique({
          where: { applicationId: app.id },
          select: {
            id: true,
            name: true,
            baseUrl: true,
            issuerUrl: true,
            clientId: true,
            scopes: true,
            status: true,
            credentials: { where: { userId: user.id }, select: { subject: true, expiresAt: true } },
          },
        }),
        db.executionLog.findMany({
          where: { applicationId: app.id },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        db.oAuthClient.findMany({ where: { applicationId: app.id, userId: user.id } }),
        db.confirmation.findMany({
          where: {
            applicationId: app.id,
            userId: user.id,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      return Response.json({
        application: app,
        run,
        capabilities,
        environment,
        logs,
        clients,
        confirmations,
        endpoint: `${appUrl()}/mcp/${app.slug}`,
      });
    }
    if (action === 'analyze' && method === 'POST') {
      if (!configured(githubKeys) || !configured(['GEMINI_API_KEY', 'GEMINI_ANALYSIS_MODEL']))
        throw new HiveError('ANALYSIS_CONFIGURATION_REQUIRED', 503);
      if (!app.enabled) throw new HiveError('APPLICATION_DISABLED', 403);
      const run = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${app.id}))`;
        if (
          await tx.analysisRun.count({
            where: { applicationId: app.id, status: { in: ['QUEUED', 'RUNNING'] } },
          })
        )
          throw new HiveError('ANALYSIS_ALREADY_RUNNING', 409);
        return tx.analysisRun.create({ data: { applicationId: app.id } });
      });
      try {
        await analysisQueue().add(
          'analyze',
          { runId: run.id },
          { jobId: run.id, attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
        );
      } catch {
        await db.analysisRun.update({
          where: { id: run.id },
          data: { status: 'FAILED', errorCode: 'QUEUE_UNAVAILABLE' },
        });
        throw new HiveError('QUEUE_UNAVAILABLE', 503);
      }
      return Response.json(run, { status: 202 });
    }
    if (action === 'graph' && method === 'GET') {
      const run = await db.analysisRun.findFirst({
        where: { applicationId: app.id },
        orderBy: { createdAt: 'desc' },
        include: { nodes: true, edges: true },
      });
      return Response.json({ nodes: run?.nodes ?? [], edges: run?.edges ?? [] });
    }
    if (action === 'capabilities' && parts[3] && method === 'PATCH') {
      const input = z
        .object({
          status: z.enum(['APPROVED', 'REJECTED']).optional(),
          policy: z.enum(['automatic', 'confirmation_required', 'disabled']).optional(),
          enabled: z.boolean().optional(),
          displayName: z.string().min(3).max(100).optional(),
          description: z.string().min(10).max(1200).optional(),
        })
        .strict()
        .parse(await body(request));
      const cap = await db.capability.findFirst({ where: { id: parts[3], applicationId: app.id } });
      if (!cap) throw new HiveError('CAPABILITY_NOT_FOUND', 404);
      if (input.status === 'APPROVED') {
        if (
          cap.status === 'STALE' ||
          app.sourceChanged ||
          !(cap.implementation as { supported?: boolean }).supported
        )
          throw new HiveError('ANALYSIS_REQUIRED', 409);
      }
      if (cap.risk === 'critical' && input.policy && input.policy !== 'disabled')
        throw new HiveError('CRITICAL_CAPABILITY_DISABLED', 403);
      if (cap.operationType !== 'READ' && input.policy === 'automatic')
        throw new HiveError('WRITE_CONFIRMATION_REQUIRED', 403);
      const rejecting = input.status === 'REJECTED';
      const saved = await db.capability.update({
        where: { id: cap.id },
        data: {
          ...input,
          ...(rejecting
            ? { enabled: false, verifiedAt: null }
            : input.status === 'APPROVED'
              ? { enabled: cap.policy !== 'disabled' }
              : {}),
        },
      });
      return Response.json(saved);
    }
    if (action === 'publish' && method === 'POST') {
      const { published } = z.object({ published: z.boolean() }).parse(await body(request));
      if (published) {
        if (!app.enabled || app.sourceChanged) throw new HiveError('ANALYSIS_REQUIRED', 409);
        if (
          !(await db.capability.count({
            where: {
              applicationId: app.id,
              status: { in: ['APPROVED', 'VERIFIED'] },
              enabled: true,
              policy: { not: 'disabled' },
            },
          }))
        )
          throw new HiveError('NO_APPROVED_CAPABILITIES', 409);
        const env = await db.applicationEnvironment.findUnique({
          where: { applicationId: app.id },
          include: { credentials: { where: { userId: user.id, expiresAt: { gt: new Date() } } } },
        });
        if (!env?.credentials.length)
          throw new HiveError('APPLICATION_AUTHORIZATION_REQUIRED', 409);
      }
      return Response.json(
        await db.application.update({ where: { id: app.id }, data: { published } }),
      );
    }
    if (action === 'environment' && method === 'POST') {
      const input = z
        .object({
          name: z.string().min(1).max(80),
          baseUrl: z.string().url(),
          issuerUrl: z.string().url(),
          clientId: z.string().min(1).max(300),
          clientSecret: z.string().max(3000).optional(),
          scopes: z.string().max(500),
        })
        .strict()
        .parse(await body(request));
      const { clientSecret, ...values } = input;
      values.baseUrl = validateBaseUrl(values.baseUrl);
      values.issuerUrl = validateBaseUrl(values.issuerUrl);
      if (values.baseUrl === appUrl()) throw new HiveError('APPLICATION_CANNOT_BE_HIVE');
      await db.$transaction(async (tx) => {
        const env = await tx.applicationEnvironment.upsert({
          where: { applicationId: app.id },
          create: { applicationId: app.id, ...values },
          update: { ...values, status: 'CONFIGURED' },
        });
        await tx.applicationEnvironment.update({
          where: { id: env.id },
          data: {
            encryptedClientSecret: clientSecret ? encrypt(clientSecret, `env:${env.id}`) : null,
          },
        });
        await tx.applicationCredential.deleteMany({ where: { environmentId: env.id } });
        await tx.application.update({ where: { id: app.id }, data: { published: false } });
      });
      return Response.json({ ok: true });
    }
    if (action === 'authorize' && method === 'POST')
      return Response.json({ url: await beginApplicationOAuth(app.id, user.id) });
    if (action === 'disconnect' && method === 'POST') {
      const env = await db.applicationEnvironment.findUnique({ where: { applicationId: app.id } });
      if (env)
        await db.applicationCredential.deleteMany({
          where: { environmentId: env.id, userId: user.id },
        });
      await db.application.update({ where: { id: app.id }, data: { published: false } });
      return Response.json({ ok: true });
    }
    if (action === 'clients' && method === 'POST') {
      const input = z
        .object({
          name: z.string().min(1).max(100),
          redirectUris: z.array(redirectUri).min(1).max(5),
        })
        .strict()
        .parse(await body(request));
      return Response.json(
        await db.oAuthClient.create({ data: { ...input, userId: user.id, applicationId: app.id } }),
      );
    }
    if (action === 'clients' && parts[3] && method === 'DELETE') {
      await db.$transaction([
        db.agentToken.updateMany({
          where: { clientId: parts[3], userId: user.id, applicationId: app.id },
          data: { revokedAt: new Date() },
        }),
        db.oAuthClient.deleteMany({
          where: { id: parts[3], userId: user.id, applicationId: app.id },
        }),
      ]);
      return Response.json({ ok: true });
    }
    if (action === 'confirmations' && parts[3] && method === 'POST') {
      const result = await db.confirmation.updateMany({
        where: {
          id: parts[3],
          applicationId: app.id,
          userId: user.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { approvedAt: new Date() },
      });
      if (!result.count) throw new HiveError('INVALID_CONFIRMATION');
      return Response.json({ ok: true });
    }
    if (action === 'test' && method === 'POST') {
      const input = z
        .object({ name: z.string(), arguments: z.record(z.unknown()) })
        .strict()
        .parse(await body(request));
      return Response.json(await withMcp(user.id, app.id, (client) => client.callTool(input)));
    }
    if (action === 'playground' && method === 'POST') {
      if (!(await rateLimit(`playground:${user.id}`, 10, 600)))
        throw new HiveError('RATE_LIMITED', 429);
      const { prompt } = z
        .object({ prompt: z.string().min(1).max(4000) })
        .parse(await body(request));
      return Response.json(await runPlayground(user.id, app.id, prompt));
    }
  }
  throw new HiveError('NOT_FOUND', 404);
});
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
