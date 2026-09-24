import { LaunchSequenceSchema as InputSchema } from '@/lib/schemas';
import { requirePermission } from '@/lib/permissions';
import { SequenceService } from '@/services/crm-service';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requirePermission(request, 'SEQUENCE_LAUNCH');
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const input = InputSchema.parse(await request.json());
  const { id } = await context.params;
  return Response.json(SequenceService.launchSequence(id, input));
}
