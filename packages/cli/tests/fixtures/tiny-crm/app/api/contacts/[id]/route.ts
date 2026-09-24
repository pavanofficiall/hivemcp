import { requirePermission } from '@/lib/permissions';
import { ContactService } from '@/services/crm-service';
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requirePermission(request, 'CONTACT_DELETE');
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  return Response.json(ContactService.deleteContact((await context.params).id));
}
