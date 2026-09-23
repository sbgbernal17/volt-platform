import { useState } from 'react';
import { useApi } from '../auth/auth.tsx';
import { DataTable } from '../components/data-table.tsx';
import { Alert, Badge, ErrorBox, JsonView, Loading, PageHeader } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { dateTime } from '../lib/format.ts';
import type { AuditEntry, Items } from '../lib/types.ts';
import { useMutation, useQuery } from '../lib/use-query.ts';

export function AuditPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const [filters, setFilters] = useState({ action: '', entityId: '', actorId: '' });
  const [applied, setApplied] = useState(filters);
  const [extra, setExtra] = useState<AuditEntry[]>([]);
  const audit = useQuery(
    () =>
      api.get<Items<AuditEntry>>('/audit', {
        action: applied.action || undefined,
        entityId: applied.entityId || undefined,
        actorId: applied.actorId || undefined,
        limit: 100,
      }),
    [applied],
  );
  const verify = useMutation();
  const [verification, setVerification] = useState<{
    ok: boolean;
    checked: number;
    brokenAtId: string | null;
  } | null>(null);
  const rows = [...(audit.data?.items ?? []), ...extra];

  const loadMore = async () => {
    const last = rows.at(-1);
    if (!last) return;
    const more = await api.get<Items<AuditEntry>>('/audit', {
      action: applied.action || undefined,
      entityId: applied.entityId || undefined,
      actorId: applied.actorId || undefined,
      beforeId: last.id,
      limit: 100,
    });
    setExtra([...extra, ...more.items]);
  };

  return (
    <>
      <PageHeader
        title={t('audit.title')}
        actions={
          <button
            type="button"
            disabled={verify.busy}
            onClick={() =>
              void verify
                .run(() =>
                  api.post<{ ok: boolean; checked: number; brokenAtId: string | null }>(
                    '/audit/verify',
                  ),
                )
                .then((r) => {
                  if (r) setVerification(r);
                })
            }
          >
            {t('audit.verify')}
          </button>
        }
      />
      {verification ? (
        <Alert tone={verification.ok ? 'ok' : 'error'}>
          {verification.ok
            ? t('audit.chainOk')
            : `${t('audit.chainBroken')} ${verification.brokenAtId}`}{' '}
          · {verification.checked} {t('audit.checked')}
        </Alert>
      ) : null}
      <ErrorBox error={verify.error} />
      <form
        className="card compact row"
        onSubmit={(e) => {
          e.preventDefault();
          setExtra([]);
          setApplied(filters);
        }}
      >
        <input
          placeholder={t('audit.filterAction')}
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
          style={{ width: 200 }}
        />
        <input
          placeholder={t('audit.filterEntity')}
          value={filters.entityId}
          onChange={(e) => setFilters({ ...filters, entityId: e.target.value })}
          style={{ width: 300 }}
        />
        <input
          placeholder={t('audit.filterActor')}
          value={filters.actorId}
          onChange={(e) => setFilters({ ...filters, actorId: e.target.value })}
          style={{ width: 240 }}
        />
        <button type="submit">{t('app.search')}</button>
      </form>
      <div className="card">
        <ErrorBox error={audit.error} />
        {audit.loading ? <Loading /> : null}
        <DataTable
          rows={rows}
          rowKey={(a) => a.id}
          columns={[
            {
              key: 'when',
              header: t('audit.when'),
              render: (a) => dateTime(a.ts, locale),
              className: 'nowrap',
            },
            { key: 'actor', header: t('audit.actor'), render: (a) => <code>{a.actor_id}</code> },
            {
              key: 'action',
              header: t('audit.action'),
              render: (a) => <strong>{a.action}</strong>,
            },
            {
              key: 'entity',
              header: t('audit.entity'),
              render: (a) => (
                <span className="small">
                  {a.entity_type} <code>{a.entity_id}</code>
                </span>
              ),
            },
            {
              key: 'outcome',
              header: t('audit.outcome'),
              render: (a) => (
                <Badge
                  tone={a.outcome === 'OK' ? 'ok' : a.outcome === 'DENIED' ? 'warning' : 'danger'}
                >
                  {a.outcome}
                </Badge>
              ),
            },
            {
              key: 'details',
              header: '',
              render: (a) => (
                <details>
                  <summary className="small muted">{t('app.details')}</summary>
                  <JsonView value={a.after} />
                  <p className="small muted">
                    hash {a.hash.slice(0, 16)}… · {a.remote_ip ?? ''} · {a.request_id ?? ''}
                  </p>
                </details>
              ),
            },
          ]}
        />
        {rows.length >= 100 ? (
          <button type="button" className="mt" onClick={() => void loadMore()}>
            {t('audit.loadMore')}
          </button>
        ) : null}
      </div>
    </>
  );
}
