import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { appUrl } from '@/lib/config';
import { HiveError } from '@/lib/errors';
import { randomToken, sessionHash } from '@/modules/security/crypto';
const cookieName = 'hive_session';
export async function currentUser() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { id: sessionHash(token) },
    include: { user: true },
  });
  return session && session.expiresAt > new Date() ? session.user : null;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new HiveError('AUTHENTICATION_REQUIRED', 401);
  return user;
}
export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  await db.session.create({ data: { id: sessionHash(token), userId, expiresAt } });
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    secure: appUrl().startsWith('https:'),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}
export async function logout() {
  const cookie = (await cookies()).get(cookieName)?.value;
  if (cookie) await db.session.deleteMany({ where: { id: sessionHash(cookie) } });
  (await cookies()).delete(cookieName);
}
export function checkOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(appUrl()).origin)
    throw new HiveError('INVALID_ORIGIN', 403);
}
export async function ownedApp(id: string, userId: string) {
  const application = await db.application.findUnique({ where: { id } });
  if (!application) throw new HiveError('APPLICATION_NOT_FOUND', 404);
  if (application.userId !== userId) throw new HiveError('APPLICATION_ACCESS_DENIED', 403);
  return application;
}
