import { handleMcp } from '@/modules/mcp/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handler(request: Request, context: { params: Promise<{ slug: string }> }) {
  return handleMcp(request, (await context.params).slug);
}
export { handler as POST, handler as GET, handler as DELETE };
