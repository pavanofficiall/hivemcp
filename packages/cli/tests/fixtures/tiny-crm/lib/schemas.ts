import { z } from 'zod';
export const CreateContactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string(),
  email: z.string().email(),
  companyId: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  phone: z.string().nullable().optional(),
});
export const CreateDealSchema = z.object({ title: z.string(), amount: z.number().min(0) });
export const LaunchSequenceSchema = z.object({
  confirm: z.boolean(),
  channel: z.enum(['email', 'sms']).optional(),
});
