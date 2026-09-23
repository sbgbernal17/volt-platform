import { useState } from 'react';
import { useApi, useAuth } from '../auth/auth.tsx';
import { ConfirmDialog } from '../components/confirm-dialog.tsx';
import { DataTable } from '../components/data-table.tsx';
import {
  Alert,
  ErrorBox,
  JsonView,
  Loading,
  PageHeader,
  SeverityBadge,
} from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { dateTime } from '../lib/format.ts';
import { useRouter } from '../lib/router.tsx';
import type { Alarm, ChargePoint, Items } from '../lib/types.ts';
import { useMutation, useQuery } from '../lib/use-query.ts';

export function AlarmsPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const [includeResolved, setIncludeResolved] = useState(false);
  const alarms = useQuery(
    () => api.get<Items<Alarm>>('/alarms', { includeResolved: includeResolved || undefined }),
    [includeResolved],
    { refreshMs: 10_000 },
  );
  const chargePoints = useQuery(() => api.get<Items<ChargePoint>>('/charge-points'), []);
  const mutation = useMutation();
  const [resolving, setResolving] = useState<Alarm | null>(null);
  const name = (id: string | null) =>
    chargePoints.data?.items.find((cp) => cp.id === id)?.charge_box_id ??
    (id ? id.slice(0, 8) : '—');

  return (
    <>
      <PageHeader
        title={t('alarms.title')}
        actions={
          <label className="check">
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(e) => setIncludeResolved(e.target.checked)}
            />
            {t('alarms.includeResolved')}
          </label>
        }
      />
      <ErrorBox error={mutation.error} />
      {mutation.message ? <Alert tone="ok">{mutation.message}</Alert> : null}
      <div className="card">
        <ErrorBox error={alarms.error} />
        {alarms.loading ? <Loading /> : null}
        <DataTable
          rows={alarms.data?.items ?? []}
          rowKey={(a) => a.id}
          columns={[
            {
              key: 'sev',
              header: t('alarms.severity'),
              render: (a) => <SeverityBadge value={a.severity} />,
            },
            { key: 'kind', header: t('alarms.kind'), render: (a) => <strong>{a.kind}</strong> },
            {
              key: 'cp',
              header: t('alarms.chargePoint'),
              render: (a) =>
                a.charge_point_id ? (
                  <button
                    type="button"
                    className="link"
                    onClick={() => navigate(`/charge-points/${a.charge_point_id}`)}
                  >
                    {name(a.charge_point_id)}
                  </button>
                ) : (
                  '—'
                ),
            },
            { key: 'status', header: t('app.status'), render: (a) => a.status },
            {
              key: 'n',
              header: t('alarms.occurrences'),
              render: (a) => a.occurrences,
              align: 'right',
            },
            {
              key: 'first',
              header: t('alarms.firstSeen'),
              render: (a) => dateTime(a.first_seen_at, locale),
            },
            {
              key: 'last',
              header: t('alarms.lastSeen'),
              render: (a) => dateTime(a.last_seen_at, locale),
            },
            {
              key: 'details',
              header: '',
              render: (a) => (
                <details>
                  <summary className="small muted">{t('app.details')}</summary>
                  <JsonView value={a.details} />
                  {a.resolution ? (
                    <p className="small">
                      {t('alarms.resolution')}: {a.resolution}
                    </p>
                  ) : null}
                </details>
              ),
            },
            {
              key: 'act',
              header: '',
              render: (a) =>
                auth.can('alarms:resolve') && a.status !== 'RESOLVED' ? (
                  <button type="button" className="small" onClick={() => setResolving(a)}>
                    {t('alarms.resolve')}
                  </button>
                ) : null,
            },
          ]}
        />
      </div>
      <ConfirmDialog
        open={resolving !== null}
        title={`${t('alarms.resolve')}: ${resolving?.kind ?? ''}`}
        requireReason
        confirmLabel={t('alarms.resolve')}
        busy={mutation.busy}
        onCancel={() => setResolving(null)}
        onConfirm={async (resolution) => {
          const alarm = resolving;
          setResolving(null);
          if (alarm) {
            await mutation.run(
              () => api.post(`/alarms/${alarm.id}/resolve`, { resolution }),
              t('alarms.resolved'),
            );
            void alarms.reload();
          }
        }}
      />
    </>
  );
}
