import { CreateContactSchema } from '@/lib/schemas';
import { requirePermission } from '@/lib/permissions';
import { ContactService } from '@/services/crm-service';
export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  return Response.json(ContactService.searchContacts(searchParams.get('q')));
}
export async function POST(request: Request) {
  try {
    requirePermission(request, 'CONTACT_CREATE');
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = CreateContactSchema.parse(await request.json());
  return Response.json(ContactService.createContact(body), { status: 201 });
}
