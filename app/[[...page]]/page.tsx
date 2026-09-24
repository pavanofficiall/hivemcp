import { currentUser } from '@/modules/auth/session';
import { Login } from '@/components/login';
import { Dashboard } from '@/components/dashboard';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const user = await currentUser();
  return user ? <Dashboard user={{ name: user.name, email: user.email }} /> : <Login />;
}
