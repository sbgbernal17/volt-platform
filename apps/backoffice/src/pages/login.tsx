import type { MultiFactorResolver } from 'firebase/auth';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/auth.tsx';
import { Alert } from '../components/ui.tsx';
import { type MessageKey, useI18n } from '../i18n/index.tsx';

const API_ERROR_KEYS: Record<string, MessageKey> = {
  STAFF_NOT_INVITED: 'login.notInvited',
  STAFF_DISABLED: 'login.disabled',
  EMAIL_NOT_VERIFIED: 'login.verifyEmail',
  REAUTH_REQUIRED: 'login.reauth',
  TOKEN_EXPIRED: 'login.reauth',
  UNAUTHORIZED: 'login.wrongCredentials',
};

function firebaseErrorKey(code: string | undefined): MessageKey | null {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
    case 'auth/invalid-verification-code':
      return 'login.wrongCredentials';
    case 'auth/too-many-requests':
      return 'login.tooMany';
    default:
      return null;
  }
}

export function LoginPage() {
  const { t, locale, setLocale } = useI18n();
  const auth = useAuth();
  const [email, setEmail] = useState(auth.email ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);
  const [token, setToken] = useState('');
  const [actor, setActor] = useState('');
  const [showToken, setShowToken] = useState(auth.config?.provider === 'token');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apiErrorKey = auth.error ? API_ERROR_KEYS[auth.error] : undefined;
  const identity = auth.config?.provider === 'identity-platform' && auth.config.apiKey;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setLocalError(null);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      const key = firebaseErrorKey((error as { code?: string }).code);
      setLocalError(key ? t(key) : (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const mfa = await auth.signInWithPassword(email.trim(), password);
      if (mfa) setResolver(mfa);
    });
  };

  const submitMfa = (event: FormEvent) => {
    event.preventDefault();
    if (!resolver) return;
    void run(async () => {
      await auth.resolveMfa(resolver, code.trim());
      setResolver(null);
    });
  };

  const submitToken = (event: FormEvent) => {
    event.preventDefault();
    void run(() => auth.signInWithToken(token, actor));
  };

  return (
    <div className="login">
      <div className="card">
        <div className="row between mb">
          <div className="brand">
            <span className="logo">⚡</span>
            <span>Volt</span>
          </div>
          <select
            aria-label={t('app.language')}
            value={locale}
            onChange={(e) => setLocale(e.target.value as 'es' | 'en')}
            style={{ width: 'auto' }}
          >
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </div>
        <h1>{resolver ? t('login.mfaTitle') : t('login.title')}</h1>
        {apiErrorKey ? <Alert tone="warning">{t(apiErrorKey)}</Alert> : null}
        {auth.error && !apiErrorKey ? <Alert tone="error">{auth.error}</Alert> : null}
        {localError ? <Alert tone="error">{localError}</Alert> : null}
        {notice ? <Alert tone="ok">{notice}</Alert> : null}
        {auth.error === 'EMAIL_NOT_VERIFIED' ? (
          <button
            type="button"
            className="mb"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await auth.resendVerification();
                setNotice(t('login.verificationSent'));
              })
            }
          >
            {t('login.resendVerification')}
          </button>
        ) : null}

        {identity && resolver ? (
          <form onSubmit={submitMfa}>
            <p className="help">{t('login.mfaHelp')}</p>
            <label className="field">
              <span>{t('login.mfaCode')}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
            <div className="form-actions">
              <button type="button" onClick={() => setResolver(null)} disabled={busy}>
                {t('app.back')}
              </button>
              <button type="submit" className="primary" disabled={busy || code.trim().length < 6}>
                {t('login.submit')}
              </button>
            </div>
          </form>
        ) : identity ? (
          <form onSubmit={submitPassword}>
            <label className="field">
              <span>{t('login.email')}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="field">
              <span>{t('login.password')}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="link"
                disabled={busy || !email}
                onClick={() =>
                  void run(async () => {
                    await auth.resetPassword(email.trim());
                    setNotice(t('login.resetSent'));
                  })
                }
              >
                {t('login.forgot')}
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {t('login.submit')}
              </button>
            </div>
          </form>
        ) : !auth.config?.tokenLogin ? (
          <Alert tone="warning">{t('login.noProvider')}</Alert>
        ) : null}

        {auth.config?.tokenLogin ? (
          <div className="mt">
            {identity ? (
              <button type="button" className="link small" onClick={() => setShowToken((v) => !v)}>
                {t('login.tokenTitle')}
              </button>
            ) : (
              <h2>{t('login.tokenTitle')}</h2>
            )}
            {showToken ? (
              <form onSubmit={submitToken} className="mt">
                <label className="field">
                  <span>{t('login.token')}</span>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    autoComplete="off"
                    required
                  />
                </label>
                <label className="field">
                  <span>{t('login.tokenActor')}</span>
                  <input
                    value={actor}
                    onChange={(e) => setActor(e.target.value)}
                    placeholder="staff:ana"
                  />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary" disabled={busy || !token}>
                    {t('login.tokenSubmit')}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
