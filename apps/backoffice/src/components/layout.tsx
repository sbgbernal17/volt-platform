import { type ReactNode, useState } from 'react';
import { useAuth } from '../auth/auth.tsx';
import { type MessageKey, useI18n } from '../i18n/index.tsx';
import { Link } from '../lib/router.tsx';
import { applyTheme, readTheme, THEMES, type Theme } from '../lib/theme.ts';
import { Icon } from './icon.tsx';

interface NavItem {
  to: string;
  label: MessageKey;
  icon: string;
  permission: string | null;
}

const NAV: NavItem[] = [
  { to: '/', label: 'nav.dashboard', icon: 'map', permission: 'overview:read' },
  { to: '/sites', label: 'nav.sites', icon: 'place', permission: 'inventory:read' },
  {
    to: '/charge-points',
    label: 'nav.chargePoints',
    icon: 'ev-station',
    permission: 'inventory:read',
  },
  { to: '/sessions', label: 'nav.sessions', icon: 'bolt', permission: 'sessions:read' },
  { to: '/tariffs', label: 'nav.tariffs', icon: 'sell', permission: 'pricing:read' },
  { to: '/simulator', label: 'nav.simulator', icon: 'calculate', permission: 'pricing:read' },
  { to: '/parameters', label: 'nav.parameters', icon: 'tune', permission: 'params:read' },
  { to: '/payments', label: 'nav.payments', icon: 'credit-card', permission: 'billing:read' },
  { to: '/drivers', label: 'nav.drivers', icon: 'person', permission: 'drivers:read' },
  { to: '/alarms', label: 'nav.alarms', icon: 'notifications', permission: 'alarms:read' },
  { to: '/audit', label: 'nav.audit', icon: 'history', permission: 'audit:read' },
  { to: '/staff', label: 'nav.staff', icon: 'group', permission: 'staff:read' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { t, td, locale, setLocale } = useI18n();
  const auth = useAuth();
  const [theme, setTheme] = useState<Theme>(() =>
    readTheme(typeof window === 'undefined' ? null : window.localStorage),
  );
  const changeTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next, document.documentElement, window.localStorage);
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/brand/volt-logo-rojo.svg" alt="VOLT" />
        </div>
        {NAV.filter((item) => !item.permission || auth.can(item.permission)).map((item) => (
          <Link key={item.to} to={item.to}>
            <Icon name={item.icon} />
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
            <select
              aria-label={t('app.theme')}
              value={theme}
              onChange={(event) => changeTheme(event.target.value as Theme)}
            >
              {THEMES.map((option) => (
                <option key={option} value={option}>
                  {td(`app.theme.${option}`)}
                </option>
              ))}
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
