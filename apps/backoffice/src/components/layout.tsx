import type { ReactNode } from 'react';
import { useAuth } from '../auth/auth.tsx';
import { type MessageKey, useI18n } from '../i18n/index.tsx';
import { Link } from '../lib/router.tsx';

interface NavItem {
  to: string;
  label: MessageKey;
  permission: string | null;
}

const NAV: NavItem[] = [
  { to: '/', label: 'nav.dashboard', permission: 'overview:read' },
  { to: '/sites', label: 'nav.sites', permission: 'inventory:read' },
  { to: '/charge-points', label: 'nav.chargePoints', permission: 'inventory:read' },
  { to: '/sessions', label: 'nav.sessions', permission: 'sessions:read' },
  { to: '/tariffs', label: 'nav.tariffs', permission: 'pricing:read' },
  { to: '/simulator', label: 'nav.simulator', permission: 'pricing:read' },
  { to: '/parameters', label: 'nav.parameters', permission: 'params:read' },
  { to: '/payments', label: 'nav.payments', permission: 'billing:read' },
  { to: '/drivers', label: 'nav.drivers', permission: 'drivers:read' },
  { to: '/alarms', label: 'nav.alarms', permission: 'alarms:read' },
  { to: '/audit', label: 'nav.audit', permission: 'audit:read' },
  { to: '/staff', label: 'nav.staff', permission: 'staff:read' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const auth = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">⚡</span>
          <span>Volt</span>
        </div>
        {NAV.filter((item) => !item.permission || auth.can(item.permission)).map((item) => (
          <Link key={item.to} to={item.to}>
            {t(item.label)}
          </Link>
        ))}
        <div className="spacer" />
        <div className="me">
          <div>
            <strong>{auth.me?.displayName ?? auth.me?.email ?? auth.me?.actor}</strong>
          </div>
          <div>
            {t('app.role')}: {auth.me?.role}
            {auth.me?.mfa ? ' · MFA' : ''}
          </div>
          <div className="row mt">
            <select
              aria-label={t('app.language')}
              value={locale}
              onChange={(event) => setLocale(event.target.value as 'es' | 'en')}
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
            <button type="button" className="small" onClick={() => void auth.signOut()}>
              {t('app.signOut')}
            </button>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
