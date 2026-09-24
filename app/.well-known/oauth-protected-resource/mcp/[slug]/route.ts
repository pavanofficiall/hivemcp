import { appUrl } from '@/lib/config';
import { db } from '@/lib/db';
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const app = await db.application.findUnique({ where: { slug } });
  if (!app || !app.enabled || !app.published)
    return Response.json({ error: 'APPLICATION_NOT_FOUND' }, { status: 404 });
  return Response.json({
    resource: `${appUrl()}/mcp/${app.slug}`,
    authorization_servers: [appUrl()],
    scopes_supported: ['capabilities:execute'],
    bearer_methods_supported: ['header'],
  });
}
