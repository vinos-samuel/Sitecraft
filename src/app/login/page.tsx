'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        router.push('/');
        router.refresh();
      } else {
        setError(data.error || 'Login failed.');
      }
    } catch {
      setError('Login failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 52px)' }}>
      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-divider)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', padding: '2.25rem', width: '360px',
      }}>
        <h1 style={{ fontSize: '1.6rem', marginBottom: '0.4rem' }}>OmniLead</h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
          Enter the team password to continue.
        </p>
        <form onSubmit={login} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="password"
            className="input-field"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            style={{ padding: '0.75rem 1rem' }}
          />
          {error && <div style={{ color: 'var(--accent-2)', fontSize: '0.85rem' }}>{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={loading || !password}>
            {loading ? 'Checking...' : 'Log In'}
          </button>
        </form>
      </div>
    </main>
  );
}
