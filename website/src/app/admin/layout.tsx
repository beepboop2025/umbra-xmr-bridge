'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { Shield, LogIn } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

const ADMIN_TOKEN_KEY = 'umbra_admin_token';

function useAdminAuth() {
  const [state, setState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  useEffect(() => {
    const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    if (token) {
      apiClient.setToken(token);
      setState('authenticated');
    } else {
      setState('unauthenticated');
    }
  }, []);

  const login = async (token: string) => {
    apiClient.setToken(token);
    try {
      // Verify the token by hitting a protected admin endpoint
      await apiClient.getSystemHealth();
      sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
      setState('authenticated');
      return true;
    } catch {
      apiClient.setToken(null);
      return false;
    }
  };

  const logout = () => {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    apiClient.setToken(null);
    setState('unauthenticated');
  };

  return { state, login, logout };
}

function AdminLogin({ onLogin }: { onLogin: (token: string) => Promise<boolean> }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setLoading(true);
    setError('');

    const success = await onLogin(token.trim());
    if (!success) {
      setError('Invalid admin token');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-xmr-500/10 border border-xmr-500/20 flex items-center justify-center mx-auto mb-4">
            <Shield size={24} className="text-xmr-400" />
          </div>
          <h1 className="text-xl font-bold text-white">Admin Access</h1>
          <p className="text-sm text-gray-400 mt-1">Enter your admin token to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Admin token"
              autoFocus
              className="w-full px-4 py-3 rounded-xl bg-surface-elevated border border-surface-border text-white placeholder-gray-500 focus:outline-none focus:border-xmr-500/50 transition-colors"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-xmr-500 hover:bg-xmr-600 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <LogIn size={16} />
            {loading ? 'Verifying...' : 'Authenticate'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { state, login } = useAdminAuth();

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-xmr-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (state === 'unauthenticated') {
    return <AdminLogin onLogin={login} />;
  }

  return <>{children}</>;
}
