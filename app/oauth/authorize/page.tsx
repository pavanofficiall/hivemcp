import { currentUser } from '@/modules/auth/session';
import { validateAuthorization } from '@/modules/oauth/agent';
import { Login } from '@/components/login';
export const dynamic = 'force-dynamic';
export default async function Consent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  if (!user) return <Login returnTo={`/oauth/authorize?${new URLSearchParams(params)}`} />;
  try {
    const { application, client, input } = await validateAuthorization(params, user.id);
    return (
      <main className="auth-page">
        <section className="auth-card">
          <span className="eyebrow">HIVE AGENT AUTHORIZATION</span>
          <h1>Connect {client.name}</h1>
          <p>
            Allow this client to discover and execute the approved capabilities of{' '}
            <strong>{application.name}</strong> as {user.email}. Application permissions and Hive
            confirmation policies still apply.
          </p>
          <pre>{input.resource}</pre>
          <form method="POST" action="/api/oauth/authorize">
            {Object.entries(input).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <button className="button button-primary" name="approve" value="yes">
              Authorize client
            </button>
          </form>
          <a href="/">Cancel</a>
        </section>
      </main>
    );
  } catch {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Authorization unavailable</h1>
          <p>The client, callback, or application does not match a registered grant.</p>
          <a href="/">Return to Hive</a>
        </section>
      </main>
    );
  }
}
