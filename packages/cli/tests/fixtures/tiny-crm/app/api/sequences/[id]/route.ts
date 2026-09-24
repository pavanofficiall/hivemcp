import { SequenceService } from '@/services/crm-service';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return Response.json(SequenceService.getSequence((await context.params).id));
}
