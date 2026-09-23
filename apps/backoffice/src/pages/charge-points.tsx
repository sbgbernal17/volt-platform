import { type FormEvent, useState } from 'react';
import { useApi, useAuth } from '../auth/auth.tsx';
import { DataTable } from '../components/data-table.tsx';
import { Alert, ErrorBox, Field, LifecycleBadge, Loading, PageHeader } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { dateTime, relativeTime } from '../lib/format.ts';
import { useRouter } from '../lib/router.tsx';
import type { ChargePoint, Items, Site } from '../lib/types.ts';
import { useMutation, useQuery } from '../lib/use-query.ts';

export const LIFECYCLE_STATES = [
  'INVENTORIED',
  'PROVISIONED',
  'CONNECTED_PENDING',
  'CONFIGURED',
  'TESTED',
  'OPERATIONAL',
  'MAINTENANCE',
  'REJECTED',
  'DECOMMISSIONED',
] as const;

const STANDARDS = [
  'IEC_62196_T2_COMBO',
  'IEC_62196_T1_COMBO',
  'GBT_DC',
  'CHADEMO',
  'IEC_62196_T2',
  'IEC_62196_T1',
  'GBT_AC',
] as const;
const POWER_TYPES = ['DC', 'AC_3_PHASE', 'AC_1_PHASE'] as const;

interface ConnectorForm {
  ocppConnectorId: number;
  standard: string;
  powerType: string;
  maxPowerW: string;
}

export function ChargePointsPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const [siteFilter, setSiteFilter] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState('');
  const sites = useQuery(() => api.get<Items<Site>>('/sites'), []);
  const chargePoints = useQuery(
    () =>
      api.get<Items<ChargePoint>>('/charge-points', {
        siteId: siteFilter || undefined,
        lifecycle: lifecycleFilter || undefined,
      }),
    [siteFilter, lifecycleFilter],
    { refreshMs: 15_000 },
  );
  const templates = useQuery(
    () => api.get<Items<{ id: string; name: string; version: number }>>('/config-templates'),
    [],
  );
  const mutation = useMutation();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    siteId: '',
    chargeBoxId: '',
    vendor: '',
    model: '',
    serialNumber: '',
    configTemplateId: '',
    heartbeatIntervalS: '',
  });
  const [connectors, setConnectors] = useState<ConnectorForm[]>([
    { ocppConnectorId: 1, standard: 'IEC_62196_T2_COMBO', powerType: 'DC', maxPowerW: '180000' },
    { ocppConnectorId: 2, standard: 'IEC_62196_T2_COMBO', powerType: 'DC', maxPowerW: '180000' },
  ]);
  const siteName = (id: string) =>
    sites.data?.items.find((s) => s.id === id)?.code ?? id.slice(0, 8);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void mutation
      .run(
        () =>
          api.post<ChargePoint>('/charge-points', {
            siteId: form.siteId,
            chargeBoxId: form.chargeBoxId.trim(),
            vendor: form.vendor.trim() || undefined,
            model: form.model.trim() || undefined,
            serialNumber: form.serialNumber.trim() || undefined,
            configTemplateId: form.configTemplateId || undefined,
            heartbeatIntervalS: form.heartbeatIntervalS
              ? Number(form.heartbeatIntervalS)
              : undefined,
            connectors: connectors.map((c) => ({
              ocppConnectorId: c.ocppConnectorId,
              standard: c.standard,
              powerType: c.powerType,
              maxPowerW: c.maxPowerW ? Number(c.maxPowerW) : undefined,
            })),
          }),
        t('cp.created'),
      )
      .then((created) => {
        if (created) navigate(`/charge-points/${created.id}`);
      });
  };

  return (
    <>
      <PageHeader
        title={t('cp.title')}
        actions={
          auth.can('inventory:write') ? (
            <button type="button" className="primary" onClick={() => setCreating((v) => !v)}>
              {t('cp.new')}
            </button>
          ) : null
        }
      />
      {creating ? (
        <form className="card" onSubmit={submit}>
          <ErrorBox error={mutation.error} />
          <div className="grid cols-3">
            <Field label={t('cp.site')}>
              <select
                value={form.siteId}
                onChange={(e) => setForm({ ...form, siteId: e.target.value })}
                required
              >
                <option value="">—</option>
                {sites.data?.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('cp.chargeBoxId')}>
              <input
                value={form.chargeBoxId}
                onChange={(e) => setForm({ ...form, chargeBoxId: e.target.value })}
                required
                minLength={3}
                maxLength={48}
                pattern="[A-Za-z0-9_.\-]+"
              />
            </Field>
            <Field label={t('cp.template')}>
              <select
                value={form.configTemplateId}
                onChange={(e) => setForm({ ...form, configTemplateId: e.target.value })}
              >
                <option value="">—</option>
                {templates.data?.items.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} v{tpl.version}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('cp.vendor')}>
              <input
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                maxLength={80}
              />
            </Field>
            <Field label={t('cp.model')}>
              <input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                maxLength={80}
              />
            </Field>
            <Field label={t('cp.serial')}>
              <input
                value={form.serialNumber}
                onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                maxLength={80}
              />
            </Field>
            <Field label={t('cp.heartbeat')}>
              <input
                type="number"
                min={10}
                max={86400}
                value={form.heartbeatIntervalS}
                onChange={(e) => setForm({ ...form, heartbeatIntervalS: e.target.value })}
              />
            </Field>
          </div>
          <h3>{t('cp.connectors')}</h3>
          {connectors.map((c, index) => (
            <div className="row mb" key={c.ocppConnectorId}>
              <span className="mono">#{c.ocppConnectorId}</span>
              <select
                value={c.standard}
                onChange={(e) =>
                  setConnectors(
                    connectors.map((x, i) =>
                      i === index ? { ...x, standard: e.target.value } : x,
                    ),
                  )
                }
                style={{ width: 220 }}
              >
                {STANDARDS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={c.powerType}
                onChange={(e) =>
                  setConnectors(
                    connectors.map((x, i) =>
                      i === index ? { ...x, powerType: e.target.value } : x,
                    ),
                  )
                }
                style={{ width: 150 }}
              >
                {POWER_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                type="number"
                placeholder="W"
                value={c.maxPowerW}
                onChange={(e) =>
                  setConnectors(
                    connectors.map((x, i) =>
                      i === index ? { ...x, maxPowerW: e.target.value } : x,
                    ),
                  )
                }
                style={{ width: 130 }}
              />
              <button
                type="button"
                className="small"
                onClick={() => setConnectors(connectors.filter((_, i) => i !== index))}
                disabled={connectors.length === 1}
              >
                {t('cp.removeConnector')}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="small"
            onClick={() =>
              setConnectors([
                ...connectors,
                {
                  ocppConnectorId: (connectors.at(-1)?.ocppConnectorId ?? 0) + 1,
                  standard: 'IEC_62196_T2_COMBO',
                  powerType: 'DC',
                  maxPowerW: '',
                },
              ])
            }
          >
            {t('cp.addConnector')}
          </button>
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
        <div className="row mb">
          <select
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            style={{ width: 240 }}
          >
            <option value="">
              {t('cp.site')}: {t('app.all')}
            </option>
            {sites.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
          <select
            value={lifecycleFilter}
            onChange={(e) => setLifecycleFilter(e.target.value)}
            style={{ width: 220 }}
          >
            <option value="">
              {t('cp.lifecycle')}: {t('app.all')}
            </option>
            {LIFECYCLE_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`lifecycle.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <ErrorBox error={chargePoints.error} />
        {chargePoints.loading ? <Loading /> : null}
        {mutation.message ? <Alert tone="ok">{mutation.message}</Alert> : null}
        {chargePoints.data ? (
          <DataTable
            rows={chargePoints.data.items}
            rowKey={(cp) => cp.id}
            onRowClick={(cp) => navigate(`/charge-points/${cp.id}`)}
            columns={[
              {
                key: 'id',
                header: t('cp.chargeBoxId'),
                render: (cp) => <strong>{cp.charge_box_id}</strong>,
              },
              { key: 'site', header: t('cp.site'), render: (cp) => siteName(cp.site_id) },
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
                render: (cp) => (
                  <span>
                    <span
                      className="dot"
                      style={{
                        background: cp.connected ? 'var(--color-ok)' : 'var(--color-danger)',
                      }}
                    />
                    {cp.connected ? t('app.yes') : t('app.no')}
                  </span>
                ),
              },
              {
                key: 'seen',
                header: t('cp.lastSeen'),
                render: (cp) => (
                  <span title={dateTime(cp.last_seen_at, locale)}>
                    {relativeTime(cp.last_seen_at, locale)}
                  </span>
                ),
              },
            ]}
          />
        ) : null}
      </div>
    </>
  );
}
