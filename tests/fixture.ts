// Synthetic analyzer fixture. This is not Orbit CRM and contains no Hive tool metadata.
export const fixture: Record<string, string> = {
  'package.json': JSON.stringify({ dependencies: { next: '16.3.4', zod: '3' } }),
  'app/api/tickets/route.ts': `import { TicketService } from '@/services/ticket-service';
import { CreateTicketSchema } from '@/schemas/ticket';
import { requirePermission } from '@/auth/permissions';
export async function POST(request:Request) {
  const user=await requirePermission('TICKET_CREATE');
  const input=CreateTicketSchema.parse(await request.json());
  return Response.json(await TicketService.createTicket(input,user));
}
export async function GET(request:Request) {
  await requirePermission('TICKET_READ');
  const status=new URL(request.url).searchParams.get('status');
  return Response.json(await TicketService.listTickets(status));
}`,
  'app/api/tickets/[id]/route.ts': `import { TicketService } from '@/services/ticket-service';
import { requirePermission } from '@/auth/permissions';
export async function DELETE(request:Request,{params}:{params:{id:string}}) {
  const user=await requirePermission('TICKET_DELETE');
  return Response.json(await TicketService.deleteTicket(params.id,user));
}`,
  'schemas/ticket.ts': `import { z } from 'zod';
export const CreateTicketSchema=z.object({title:z.string().min(3).max(80),email:z.string().email().optional(),priority:z.enum(['low','high']).default('low')});`,
  'services/ticket-service.ts': `import { prisma } from '../db';
export class TicketService {
 static async createTicket(input:{title:string},user:unknown) {
   if(input.title==='blocked') throw new Error('Title is reserved');
   return prisma.ticket.create({data:input});
 }
 static async listTickets(status:string|null) {return prisma.ticket.findMany({where:{status}});}
 static async deleteTicket(id:string,user:unknown) {return prisma.ticket.delete({where:{id}});}
}`,
  'auth/permissions.ts': `export enum Permission {TICKET_READ='TICKET_READ',TICKET_CREATE='TICKET_CREATE'}
export async function requirePermission(permission:string) {throw new Error('Fixture has no real auth runtime');}`,
  'prisma/schema.prisma': `model Ticket {
 id String @id @default(cuid())
 title String
 projectId String?
 project Project? @relation(fields: [projectId], references: [id])
 @@index([projectId])
}
model Project {
 id String @id
 tickets Ticket[]
}
enum Status {
 OPEN
 CLOSED
}`,
  'app/tickets/page.tsx': `export default function Page(){return <main>Tickets</main>}`,
  'db.ts': `export const prisma={} as any;`,
  '.env': `SYNTHETIC_SECRET=must-never-be-indexed`,
  'node_modules/ignored.ts': `export const ignored=true;`,
};
