import { createHmac } from 'node:crypto';
import { db } from '@/lib/db';
import { required } from '@/lib/config';
import { HiveError } from '@/lib/errors';
import { equal } from '@/modules/security/crypto';
import { z } from 'zod';
export async function webhook(request: Request) {
  const body = await request.text();
  if (body.length > 2000000) throw new HiveError('REQUEST_TOO_LARGE', 413);
  const expected = `sha256=${createHmac('sha256', required('GITHUB_WEBHOOK_SECRET')).update(body).digest('hex')}`;
  if (!equal(expected, request.headers.get('x-hub-signature-256') ?? ''))
    throw new HiveError('INVALID_WEBHOOK_SIGNATURE', 401);
  const delivery = z.string().uuid().parse(request.headers.get('x-github-delivery'));
  const data = JSON.parse(body);
  const event = request.headers.get('x-github-event');
  await db.$transaction(async (tx) => {
    if (await tx.webhookDelivery.findUnique({ where: { id: delivery } })) return;
    await tx.webhookDelivery.create({ data: { id: delivery } });
    if (event === 'push') {
      const payload = z
        .object({ repository: z.object({ id: z.number() }), ref: z.string(), after: z.string() })
        .parse(data);
      const apps = await tx.application.findMany({
        where: { repositoryId: payload.repository.id },
      });
      for (const app of apps)
        if (payload.ref === `refs/heads/${app.defaultBranch}`) {
          await tx.application.update({
            where: { id: app.id },
            data: { sourceChanged: true, currentCommitSha: payload.after, published: false },
          });
          await tx.capability.updateMany({
            where: { applicationId: app.id },
            data: { enabled: false, status: 'NEEDS_REVIEW', verifiedAt: null },
          });
        }
    }
    if (event === 'installation' && ['deleted', 'suspend'].includes(data.action))
      await tx.application.updateMany({
        where: { installationId: z.number().parse(data.installation?.id) },
        data: { enabled: false, published: false },
      });
    if (event === 'installation_repositories' && data.action === 'removed') {
      const ids = z
        .array(z.object({ id: z.number() }))
        .parse(data.repositories_removed)
        .map((r) => r.id);
      await tx.application.updateMany({
        where: {
          installationId: z.number().parse(data.installation?.id),
          repositoryId: { in: ids },
        },
        data: { enabled: false, published: false },
      });
    }
  });
  return Response.json({ received: true });
}
