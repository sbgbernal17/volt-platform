import { useMemo, useState } from 'react';
import { useApi } from '../auth/auth.tsx';
import { DataTable } from '../components/data-table.tsx';
import { type MapSite, SitesMap } from '../components/map.tsx';
import {
  ErrorBox,
  Kpi,
  Loading,
  PageHeader,
  SessionBadge,
  SeverityBadge,
  StatusBadge,
} from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { dateTime, energyKwh, money, relativeTime } from '../lib/format.ts';
import { Link, useRouter } from '../lib/router.tsx';
import type { Overview } from '../lib/types.ts';
import { useQuery } from '../lib/use-query.ts';

export function DashboardPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const { navigate } = useRouter();
  const [view, setView] = useState<'map' | 'list'>('map');
  const overview = useQuery(() => api.get<Overview>('/overview'), [], { refreshMs: 10_000 });
  const data = overview.data;

  const mapSites = useMemo<MapSite[]>(
    () =>
      (data?.sites ?? []).map((site) => ({
        id: site.id,
        name: site.name,
        latitude: Number(site.latitude),
        longitude: Number(site.longitude),
        online: site.chargePoints.filter((cp) => cp.connected).length,
        total: site.chargePoints.length,
        charging: site.chargePoints
          .flatMap((cp) => cp.connectors)
          .filter((c) => c.status === 'Charging').length,
        faulted: site.chargePoints
          .flatMap((cp) => cp.connectors)
          .filter((c) => c.status === 'Faulted').length,
      })),
    [data],
  );

  if (overview.error && !data) return <ErrorBox error={overview.error} />;
  if (!data) return <Loading />;
  const alarms = data.counts.openAlarms;

  return (
    <>
      <PageHeader
        title={t('dash.title')}
        actions={
          <>
            <button
              type="button"
              className={view === 'map' ? 'primary' : ''}
              onClick={() => setView('map')}
            >
              {t('dash.map')}
            </button>
            <button
              type="button"
              className={view === 'list' ? 'primary' : ''}
              onClick={() => setView('list')}
            >
              {t('dash.list')}
            </button>
            <button type="button" onClick={() => void overview.reload()}>
              {t('app.refresh')}
            </button>
          </>
        }
      />
      <div className="grid cols-4">
        <Kpi
          label={t('dash.chargePoints')}
          value={data.counts.chargePoints}
          sub={`${t('dash.online')}: ${data.counts.online} · ${t('dash.offline')}: ${data.counts.offline}`}
        />
        <Kpi
          label={t('dash.connectors')}
          value={Object.values(data.counts.connectorsByStatus).reduce((a, b) => a + b, 0)}
          sub={
            Object.entries(data.counts.connectorsByStatus)
              .map(([s, n]) => `${s}: ${n}`)
              .join(' · ') || '—'
          }
        />
        <Kpi label={t('dash.activeSessions')} value={data.counts.activeSessions} />
        <Kpi
          label={t('dash.openAlarms')}
          value={(alarms.CRITICAL ?? 0) + (alarms.WARNING ?? 0) + (alarms.INFO ?? 0)}
          sub={`${alarms.CRITICAL ?? 0} ${t('dash.critical')} · ${alarms.WARNING ?? 0} ${t('dash.warning')}`}
        />
      </div>
      {data.sites.length === 0 ? <p className="muted mt">{t('dash.noSites')}</p> : null}
      {view === 'map' && data.sites.length > 0 ? (
        <div className="card mt">
          <SitesMap sites={mapSites} onSelect={(id) => navigate(`/sites/${id}`)} />
        </div>
      ) : null}
      {view === 'list' || data.sites.length > 0 ? (
        <div className="grid cols-2 mt">
          {data.sites.map((site) => (
            <div className="card" key={site.id}>
              <div className="row between">
                <h2>
                  <Link to={`/sites/${site.id}`}>{site.name}</Link>
                </h2>
                <span className="muted small">{site.code}</span>
              </div>
              {site.chargePoints.length === 0 ? <p className="muted">{t('app.none')}</p> : null}
              {site.chargePoints.map((cp) => (
                <div key={cp.id} className="mb">
                  <div className="row between">
                    <Link to={`/charge-points/${cp.id}`}>
                      <strong>{cp.charge_box_id}</strong>
                    </Link>
                    <span className="small muted">
                      <span
                        className="dot"
                        style={{
                          background: cp.connected ? 'var(--color-ok)' : 'var(--color-danger)',
                        }}
                      />
                      {cp.connected ? t('cp.connected') : t('cp.disconnected')} ·{' '}
                      {t('dash.lastSeen')} {relativeTime(cp.last_seen_at, locale)}
                    </span>
                  </div>
                  <div className="row small">
                    {cp.connectors.map((c) => (
                      <span key={c.id}>
                        #{c.ocpp_connector_id}{' '}
                        <StatusBadge status={c.status ?? 'Unavailable'} connected={cp.connected} />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid cols-2 mt">
        <div className="card">
          <h2>{t('dash.activeSessions')}</h2>
          <DataTable
            rows={data.activeSessions}
            rowKey={(s) => s.id}
            onRowClick={(s) => navigate(`/sessions/${s.id}`)}
            columns={[
              { key: 'no', header: t('sessions.no'), render: (s) => s.session_no },
              {
                key: 'cp',
                header: t('sessions.chargePoint'),
                render: (s) => `${s.charge_box_id} · ${s.evse_code}`,
              },
              {
                key: 'state',
                header: t('sessions.state'),
                render: (s) => <SessionBadge value={s.state} />,
              },
              {
                key: 'energy',
                header: t('sessions.energy'),
                render: (s) => energyKwh(s.energy_wh, locale),
                align: 'right',
              },
              {
                key: 'cost',
                header: t('sessions.cost'),
                render: (s) =>
                  money(s.running_cost?.total_minor ?? s.total_minor, s.currency ?? 'COP', locale),
                align: 'right',
              },
            ]}
          />
        </div>
        <div className="card">
          <h2>{t('dash.openAlarms')}</h2>
          <DataTable
            rows={data.openAlarms.slice(0, 20)}
            rowKey={(a) => a.id}
            onRowClick={() => navigate('/alarms')}
            columns={[
              {
                key: 'sev',
                header: t('alarms.severity'),
                render: (a) => <SeverityBadge value={a.severity} />,
              },
              { key: 'kind', header: t('alarms.kind'), render: (a) => a.kind },
              {
                key: 'last',
                header: t('alarms.lastSeen'),
                render: (a) => dateTime(a.last_seen_at, locale),
              },
              {
                key: 'n',
                header: t('alarms.occurrences'),
                render: (a) => a.occurrences,
                align: 'right',
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}
