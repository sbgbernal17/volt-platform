import { AuthProvider, useAuth } from './auth/auth.tsx';
import { Layout } from './components/layout.tsx';
import { Loading } from './components/ui.tsx';
import { I18nProvider, useI18n } from './i18n/index.tsx';
import { type RouteDefinition, RouterProvider, Routes } from './lib/router.tsx';
import { AlarmsPage } from './pages/alarms.tsx';
import { AuditPage } from './pages/audit.tsx';
import { ChargePointDetailPage } from './pages/charge-point-detail.tsx';
import { ChargePointsPage } from './pages/charge-points.tsx';
import { DashboardPage } from './pages/dashboard.tsx';
import { DriverDetailPage, DriversPage } from './pages/drivers.tsx';
import { LoginPage } from './pages/login.tsx';
import { MfaEnrollPage } from './pages/mfa-enroll.tsx';
import { ParametersPage } from './pages/parameters.tsx';
import { PaymentsPage } from './pages/payments.tsx';
import { SessionDetailPage, SessionsPage } from './pages/sessions.tsx';
import { SimulatorPage } from './pages/simulator.tsx';
import { SiteDetailPage, SitesPage } from './pages/sites.tsx';
import { StaffPage } from './pages/staff.tsx';
import { TariffDetailPage, TariffsPage } from './pages/tariffs.tsx';

const ROUTES: RouteDefinition[] = [
  { pattern: '/', render: () => <DashboardPage /> },
  { pattern: '/sites', render: () => <SitesPage /> },
  { pattern: '/sites/:id', render: (p) => <SiteDetailPage id={p.id as string} /> },
  { pattern: '/charge-points', render: () => <ChargePointsPage /> },
  { pattern: '/charge-points/:id', render: (p) => <ChargePointDetailPage id={p.id as string} /> },
  { pattern: '/sessions', render: () => <SessionsPage /> },
  { pattern: '/sessions/:id', render: (p) => <SessionDetailPage id={p.id as string} /> },
  { pattern: '/tariffs', render: () => <TariffsPage /> },
  { pattern: '/tariffs/:id', render: (p) => <TariffDetailPage id={p.id as string} /> },
  { pattern: '/simulator', render: () => <SimulatorPage /> },
  { pattern: '/parameters', render: () => <ParametersPage /> },
  { pattern: '/payments', render: () => <PaymentsPage /> },
  { pattern: '/drivers', render: () => <DriversPage /> },
  { pattern: '/drivers/:id', render: (p) => <DriverDetailPage id={p.id as string} /> },
  { pattern: '/alarms', render: () => <AlarmsPage /> },
  { pattern: '/audit', render: () => <AuditPage /> },
  { pattern: '/staff', render: () => <StaffPage /> },
];

function Shell() {
  const auth = useAuth();
  const { t } = useI18n();
  if (auth.status === 'loading')
    return (
      <div className="login">
        <Loading />
      </div>
    );
  if (auth.status === 'mfa-enroll') return <MfaEnrollPage />;
  if (auth.status !== 'authenticated') return <LoginPage />;
  return (
    <Layout>
      <Routes routes={ROUTES} fallback={<p className="muted">{t('app.notFound')}</p>} />
    </Layout>
  );
}

export function App() {
  return (
    <I18nProvider>
      <RouterProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </RouterProvider>
    </I18nProvider>
  );
}
