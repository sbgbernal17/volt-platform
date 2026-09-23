import QRCode from 'qrcode';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { type TotpEnrollment, useAuth } from '../auth/auth.tsx';
import { Alert, Copyable } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';

/** Alta del segundo factor TOTP cuando el rol lo exige (SEG §3.1). */
export function MfaEnrollPage() {
  const { t } = useI18n();
  const auth = useAuth();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async (pwd?: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await auth.startTotpEnrollment(pwd);
      setEnrollment(result);
      setQr(await QRCode.toDataURL(result.uri, { margin: 1, width: 200 }));
      setNeedsPassword(false);
    } catch (caught) {
      const codeName = (caught as { code?: string }).code;
      if (codeName === 'auth/requires-recent-login') setNeedsPassword(true);
      else if (
        codeName === 'auth/operation-not-allowed' ||
        codeName === 'auth/unsupported-first-factor'
      )
        setError(t('mfa.notEnabled'));
      else setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    void startRef.current();
  }, []);

  const finish = (event: FormEvent) => {
    event.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    enrollment
      .finish(code.trim())
      .then(() => setDone(true))
      .catch((caught: { code?: string; message: string }) => {
        setError(
          caught.code === 'auth/invalid-verification-code'
            ? t('login.wrongCredentials')
            : caught.message,
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="login">
      <div className="card">
        <h1>{t('mfa.title')}</h1>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {done ? (
          <>
            <Alert tone="ok">{t('mfa.done')}</Alert>
            <button type="button" className="primary" onClick={() => void auth.signOut()}>
              {t('login.submit')}
            </button>
          </>
        ) : needsPassword ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void start(password);
            }}
          >
            <h2>{t('mfa.reauthTitle')}</h2>
            <p className="help">{t('mfa.reauthHelp')}</p>
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
              <button type="button" onClick={() => void auth.signOut()}>
                {t('app.signOut')}
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {t('app.confirm')}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={finish}>
            <p>{t('mfa.intro')}</p>
            {qr ? <img className="qr" src={qr} alt="TOTP" /> : null}
            {enrollment ? (
              <p className="small">
                {t('mfa.secret')}: <Copyable value={enrollment.secretKey} />
              </p>
            ) : null}
            <label className="field">
              <span>{t('mfa.code')}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
            <div className="form-actions">
              <button type="button" onClick={() => void auth.signOut()}>
                {t('app.signOut')}
              </button>
              <button
                type="submit"
                className="primary"
                disabled={busy || !enrollment || code.trim().length < 6}
              >
                {t('mfa.activate')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
