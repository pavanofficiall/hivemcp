import { CreateDealSchema } from '@/lib/schemas';
import { requirePermission } from '@/lib/permissions';
import { DealService } from '@/services/crm-service';
export const POST = async (request: Request) => {
  try {
    requirePermission(request, 'DEAL_CREATE');
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const raw = await request.json();
  const input = CreateDealSchema.parse(raw);
  return Response.json(DealService.createDeal(input), { status: 201 });
};
