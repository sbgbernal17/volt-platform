import { type FormEvent, useState } from 'react';
import { useApi, useAuth } from '../auth/auth.tsx';
import { DataTable } from '../components/data-table.tsx';
import { Alert, ErrorBox, Field, LifecycleBadge, Loading, PageHeader } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { dateTime } from '../lib/format.ts';
import { useRouter } from '../lib/router.tsx';
import type { ChargePoint, Items, Site } from '../lib/types.ts';
import { errorMessage, useMutation, useQuery } from '../lib/use-query.ts';

export function SitesPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const sites = useQuery(() => api.get<Items<Site>>('/sites'), []);
  const mutation = useMutation();
  const [form, setForm] = useState({
    code: '',
    name: '',
    address: '',
    city: '',
    latitude: '',
    longitude: '',
  });
  const [creating, setCreating] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void mutation
      .run(
        () =>
          api.post<Site>('/sites', {
            code: form.code.trim(),
            name: form.name.trim(),
            address: form.address.trim(),
            city: form.city.trim() || undefined,
            latitude: Number(form.latitude),
            longitude: Number(form.longitude),
          }),
        t('sites.created'),
      )
      .then((created) => {
        if (created) {
          setCreating(false);
          setForm({ code: '', name: '', address: '', city: '', latitude: '', longitude: '' });
          void sites.reload();
        }
      });
  };

  return (
    <>
      <PageHeader
        title={t('sites.title')}
        actions={
          auth.can('inventory:write') ? (
            <button type="button" className="primary" onClick={() => setCreating((v) => !v)}>
              {t('sites.new')}
            </button>
          ) : null
        }
      />
      {mutation.message ? <Alert tone="ok">{mutation.message}</Alert> : null}
      {creating ? (
        <form className="card" onSubmit={submit}>
          <ErrorBox error={mutation.error} />
          <div className="grid cols-2">
            <Field label={t('sites.code')}>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                required
                maxLength={32}
              />
            </Field>
            <Field label={t('sites.name')}>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                maxLength={120}
              />
            </Field>
            <Field label={t('sites.address')}>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                required
                maxLength={200}
              />
            </Field>
            <Field label={t('sites.city')}>
              <input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                maxLength={80}
              />
            </Field>
            <Field label={t('sites.latitude')}>
              <input
                type="number"
                step="any"
                value={form.latitude}
                onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                required
              />
            </Field>
            <Field label={t('sites.longitude')}>
              <input
                type="number"
                step="any"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                required
              />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" onClick={() => setCreating(false)}>
              {t('app.cancel')}
            </button>
            <button type="submit" className="primary" disabled={mutation.busy}>
              {t('app.save')}
            </button>
          </div>
        </form>
      ) : null}
      <div className="card">
        <ErrorBox error={sites.error} />
        {sites.loading ? <Loading /> : null}
        {sites.data ? (
          <DataTable
            rows={sites.data.items}
            rowKey={(s) => s.id}
            onRowClick={(s) => navigate(`/sites/${s.id}`)}
            columns={[
              { key: 'code', header: t('sites.code'), render: (s) => <strong>{s.code}</strong> },
              { key: 'name', header: t('sites.name'), render: (s) => s.name },
              {
                key: 'address',
                header: t('sites.address'),
                render: (s) => `${s.address}${s.city ? `, ${s.city}` : ''}`,
              },
              { key: 'access', header: t('sites.accessType'), render: (s) => s.access_type },
              { key: 'status', header: t('app.status'), render: (s) => s.status },
              {
                key: 'created',
                header: t('app.created'),
                render: (s) => dateTime(s.created_at, locale),
              },
            ]}
          />
        ) : null}
      </div>
    </>
  );
}

export function SiteDetailPage({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const { navigate } = useRouter();
  const site = useQuery(() => api.get<Site>(`/sites/${id}`), [id]);
  const chargePoints = useQuery(
    () => api.get<Items<ChargePoint>>('/charge-points', { siteId: id }),
    [id],
    { refreshMs: 15_000 },
  );
  if (site.error) return <ErrorBox error={site.error} />;
  if (!site.data) return <Loading />;
  const s = site.data;
  return (
    <>
      <PageHeader
        title={`${s.code} · ${s.name}`}
        actions={
          <button type="button" onClick={() => navigate('/sites')}>
            {t('app.back')}
          </button>
        }
      />
      <div className="card">
        <div className="grid cols-3">
          <div>
            <div className="muted small">{t('sites.address')}</div>
            {s.address}
            {s.city ? `, ${s.city}` : ''}
          </div>
          <div>
            <div className="muted small">
              {t('sites.latitude')} / {t('sites.longitude')}
            </div>
            {s.latitude}, {s.longitude}
          </div>
          <div>
            <div className="muted small">{t('sites.timezone')}</div>
            {s.timezone}
          </div>
          <div>
            <div className="muted small">{t('sites.accessType')}</div>
            {s.access_type}
          </div>
          <div>
            <div className="muted small">{t('app.status')}</div>
            {s.status}
          </div>
          <div>
            <div className="muted small">{t('app.created')}</div>
            {dateTime(s.created_at, locale)}
          </div>
        </div>
      </div>
      <div className="card">
        <h2>{t('sites.chargePoints')}</h2>
        {errorMessage(chargePoints.error) ? <ErrorBox error={chargePoints.error} /> : null}
        <DataTable
          rows={chargePoints.data?.items ?? []}
          rowKey={(cp) => cp.id}
          onRowClick={(cp) => navigate(`/charge-points/${cp.id}`)}
          columns={[
            {
              key: 'id',
              header: t('cp.chargeBoxId'),
              render: (cp) => <strong>{cp.charge_box_id}</strong>,
            },
            {
              key: 'model',
              header: t('cp.model'),
              render: (cp) => [cp.vendor, cp.model].filter(Boolean).join(' ') || '—',
            },
            {
              key: 'lc',
              header: t('cp.lifecycle'),
              render: (cp) => <LifecycleBadge value={cp.lifecycle_status} />,
            },
            {
              key: 'conn',
              header: t('cp.connected'),
              render: (cp) => (cp.connected ? t('app.yes') : t('app.no')),
            },
            {
              key: 'seen',
              header: t('cp.lastSeen'),
              render: (cp) => dateTime(cp.last_seen_at, locale),
            },
          ]}
        />
      </div>
    </>
  );
}
