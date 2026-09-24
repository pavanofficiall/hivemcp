'use client';
import { useState } from 'react';
import { Hexagon, ArrowRight, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
export function Login({ returnTo = '/' }: { returnTo?: string }) {
  const [register, setRegister] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <Hexagon size={29} />
        <b>hive</b>
        <span>APPLICATION INTELLIGENCE</span>
      </div>
      <section className="auth-card">
        <span className="eyebrow">YOUR SOFTWARE. AGENT READY.</span>
        <h1>{register ? 'Create your workspace' : 'Welcome back'}</h1>
        <p>Understand your application. Give agents a safe way to use it.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            const data = Object.fromEntries(new FormData(event.currentTarget));
            try {
              const res = await fetch(`/api/auth/${register ? 'register' : 'login'}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(data),
              });
              const result = await res.json();
              if (!res.ok) throw new Error(result.error);
              window.location.href =
                returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Unable to sign in');
            } finally {
              setBusy(false);
            }
          }}
        >
          {register && (
            <label>
              Name
              <input name="name" autoComplete="name" required placeholder="Your name" />
            </label>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@company.com"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              minLength={12}
              maxLength={128}
              required
              placeholder="At least 12 characters"
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error.replaceAll('_', ' ').toLowerCase()}
            </p>
          )}
          <Button disabled={busy} type="submit">
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <>
                {register ? 'Create account' : 'Sign in'}
                <ArrowRight size={16} />
              </>
            )}
          </Button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError('');
          }}
        >
          {register ? 'Already have an account? Sign in' : 'New to Hive? Create an account'}
        </button>
        <div className="auth-note">
          <span className="status-dot" /> Local development workspace · localhost:3000
        </div>
      </section>
      <footer>Source evidence → business capabilities → safe agent access</footer>
    </main>
  );
}
