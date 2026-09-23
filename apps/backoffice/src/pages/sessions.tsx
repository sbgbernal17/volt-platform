import { type FormEvent, useState } from 'react';
import { useApi, useAuth } from '../auth/auth.tsx';
import { ConfirmDialog } from '../components/confirm-dialog.tsx';
import { DataTable } from '../components/data-table.tsx';
import {
  Alert,
  Badge,
  ErrorBox,
  Field,
  JsonView,
  Loading,
  PageHeader,
  PaymentBadge,
  SessionBadge,
} from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { dateTime, duration, energyKwh, money } from '../lib/format.ts';
import { useRouter } from '../lib/router.tsx';
import type { Items, SessionView } from '../lib/types.ts';
import { useMutation, useQuery } from '../lib/use-query.ts';

const STATES = [
  'AUTHORIZING',
  'STARTING',
  'CHARGING',
  'SUSPENDED',
  'STOPPING',
  'ENDED',
  'SETTLED',
  'PAID',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
];

export function SessionsPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const [state, setState] = useState('');
  const sessions = useQuery(
    () => api.get<Items<SessionView>>('/sessions', { state: state || undefined, limit: 100 }),
    [state],
    { refreshMs: 10_000 },
  );
  const mutation = useMutation();
  const [starting, setStarting] = useState(false);
  const [form, setForm] = useState({ evseId: '', channel: 'TEST', driverId: '' });

  const start = (event: FormEvent) => {
    event.preventDefault();
    void mutation
      .run(() =>
        api.post<{ id: string }>('/sessions', {
          evseId: form.evseId.trim(),
          channel: form.channel,
          driverId: form.driverId.trim() || undefined,
        }),
      )
      .then((created) => {
        if (created) navigate(`/sessions/${created.id}`);
      });
  };

  return (
    <>
      <PageHeader
        title={t('sessions.title')}
        actions={
          auth.can('sessions:operate') ? (
            <button type="button" className="primary" onClick={() => setStarting((v) => !v)}>
              {t('sessions.start')}
            </button>
          ) : null
        }
      />
      {starting ? (
        <form className="card" onSubmit={start}>
          <p className="help">{t('sessions.startHelp')}</p>
          <ErrorBox error={mutation.error} />
          <div className="grid cols-3">
            <Field label={t('sessions.evse')}>
              <input
                value={form.evseId}
                onChange={(e) => setForm({ ...form, evseId: e.target.value })}
                placeholder="CO*VLT*E..."
                required
              />
            </Field>
            <Field label={t('sessions.channel')}>
              <select
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value })}
              >
                <option value="TEST">TEST</option>
                <option value="OPERATOR">OPERATOR</option>
              </select>
            </Field>
            <Field label={`${t('sessions.driver')} (uuid)`}>
              <input
                value={form.driverId}
                onChange={(e) => setForm({ ...form, driverId: e.target.value })}
              />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" onClick={() => setStarting(false)}>
              {t('app.cancel')}
            </button>
            <button type="submit" className="primary" disabled={mutation.busy}>
              {t('sessions.start')}
            </button>
          </div>
        </form>
      ) : null}
      <div className="card">
        <div className="row mb">
          <select value={state} onChange={(e) => setState(e.target.value)} style={{ width: 220 }}>
            <option value="">
              {t('sessions.filterState')}: {t('app.all')}
            </option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void sessions.reload()}>
            {t('app.refresh')}
          </button>
        </div>
        <ErrorBox error={sessions.error} />
        {sessions.loading ? <Loading /> : null}
        <DataTable
          rows={sessions.data?.items ?? []}
          rowKey={(s) => s.id}
          onRowClick={(s) => navigate(`/sessions/${s.id}`)}
          columns={[
            { key: 'no', header: t('sessions.no'), render: (s) => <strong>{s.session_no}</strong> },
            {
              key: 'cp',
              header: t('sessions.chargePoint'),
              render: (s) => `${s.charge_box_id} · ${s.evse_code}`,
            },
            {
              key: 'driver',
              header: t('sessions.driver'),
              render: (s) => s.driver_display_name ?? (s.driver_id ? s.driver_id.slice(0, 8) : '—'),
            },
            {
              key: 'state',
              header: t('sessions.state'),
              render: (s) => <SessionBadge value={s.state} />,
            },
            { key: 'ch', header: t('sessions.channel'), render: (s) => s.start_channel },
            {
              key: 'start',
              header: t('sessions.started'),
              render: (s) => dateTime(s.started_at ?? s.requested_at, locale),
            },
            {
              key: 'energy',
              header: t('sessions.energy'),
              render: (s) => energyKwh(s.energy_wh, locale),
              align: 'right',
            },
            {
              key: 'total',
              header: t('sessions.cost'),
              render: (s) =>
                money(s.total_minor ?? s.running_cost?.total_minor, s.currency ?? 'COP', locale),
              align: 'right',
            },
            {
              key: 'pay',
              header: t('sessions.payment'),
              render: (s) => <PaymentBadge value={s.payment_status} />,
            },
          ]}
        />
      </div>
    </>
  );
}

interface SessionDetail extends SessionView {
  events: { id: string; type: string; occurred_at: string; payload: unknown }[];
}

interface CostLine {
  seq: number;
  dimension: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  tax: string;
  total: string;
  periodStart: string | null;
  periodEnd: string | null;
}

interface CostResult {
  currency: string;
  lines: CostLine[];
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  totalMinor: string;
  capped: boolean;
  flags: string[];
  alerts: unknown[];
  summary: Record<string, unknown>;
  engineVersion: string;
}

export function SessionDetailPage({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const session = useQuery(() => api.get<SessionDetail>(`/sessions/${id}`), [id], {
    refreshMs: 5000,
  });
  const cost = useQuery(() => api.get<CostResult>(`/sessions/${id}/cost`), [id], {
    refreshMs: 15_000,
    enabled: auth.can('sessions:read'),
  });
  const mutation = useMutation();
  const [confirm, setConfirm] = useState<{
    title: string;
    danger?: boolean;
    action: (reason: string) => Promise<unknown>;
  } | null>(null);

  const run = async (reason: string) => {
    if (!confirm) return;
    const action = confirm.action;
    setConfirm(null);
    await mutation.run(() => action(reason));
    void session.reload();
    void cost.reload();
  };

  const openReceipt = async () => {
    const html = await fetch(api.url(`/sessions/${id}/receipt?format=html`), {
      headers: {
        authorization: `Bearer ${(await (api as unknown as { options: { token: () => Promise<string | null> } }).options?.token?.()) ?? ''}`,
      },
    }).then((r) => r.text());
    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank', 'noopener');
  };

  if (session.error && !session.data) return <ErrorBox error={session.error} />;
  if (!session.data) return <Loading />;
  const s = session.data;
  const live = ['AUTHORIZING', 'STARTING', 'CHARGING', 'SUSPENDED', 'STOPPING'].includes(s.state);
  const currency = s.currency ?? 'COP';

  return (
    <>
      <PageHeader
        title={`${t('sessions.title')} ${s.session_no}`}
        actions={
          <>
            <SessionBadge value={s.state} />
            <PaymentBadge value={s.payment_status} />
            {s.is_test ? <Badge tone="info">TEST</Badge> : null}
            <button type="button" onClick={() => navigate('/sessions')}>
              {t('app.back')}
            </button>
          </>
        }
      />
      <ErrorBox error={mutation.error} />
      {mutation.message ? <Alert tone="ok">{mutation.message}</Alert> : null}
      <div className="grid cols-2">
        <div className="card">
          <h2>{t('app.details')}</h2>
          <div className="grid cols-2">
            <div>
              <div className="muted small">{t('sessions.chargePoint')}</div>
              <a
                href={`/charge-points/${s.charge_point_id}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/charge-points/${s.charge_point_id}`);
                }}
              >
                {s.charge_box_id}
              </a>{' '}
              · <code>{s.evse_code}</code>
            </div>
            <div>
              <div className="muted small">{t('sessions.driver')}</div>
              {s.driver_id ? (
                <a
                  href={`/drivers/${s.driver_id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/drivers/${s.driver_id}`);
                  }}
                >
                  {s.driver_display_name ?? s.driver_id.slice(0, 8)}
                </a>
              ) : (
                '—'
              )}
            </div>
            <div>
              <div className="muted small">{t('sessions.channel')}</div>
              {s.start_channel}
            </div>
            <div>
              <div className="muted small">{t('sessions.transaction')}</div>
              {s.ocpp_transaction_no ?? '—'}
            </div>
            <div>
              <div className="muted small">{t('sessions.started')}</div>
              {dateTime(s.started_at ?? s.requested_at, locale)}
            </div>
            <div>
              <div className="muted small">{t('sessions.ended')}</div>
              {dateTime(s.ended_at, locale)}
              {s.stop_reason ? ` (${s.stop_reason})` : ''}
            </div>
            <div>
              <div className="muted small">{t('sessions.energy')}</div>
              {energyKwh(s.energy_wh, locale)}
            </div>
            <div>
              <div className="muted small">
                {t('sessions.chargingTime')} / {t('sessions.idle')}
              </div>
              {duration(s.charging_time_s)} / {duration(s.idle_time_s)}
            </div>
            <div>
              <div className="muted small">{t('sessions.tariff')}</div>
              {s.tariff_code ? `${s.tariff_code} v${s.tariff_version}` : '—'}
            </div>
            <div>
              <div className="muted small">{t('sessions.exposure')}</div>
              {money(s.exposure_limit_minor, currency, locale)}
            </div>
            <div>
              <div className="muted small">
                {live ? t('sessions.runningCost') : t('sessions.total')}
              </div>
              <strong>
                {money(live ? s.running_cost?.total_minor : s.total_minor, currency, locale)}
              </strong>
            </div>
            <div>
              <div className="muted small">{t('sessions.payment')}</div>
              <PaymentBadge value={s.payment_status} />{' '}
              {s.paid_at ? dateTime(s.paid_at, locale) : ''}
            </div>
          </div>
          {s.failure_code ? <Alert tone="error">{s.failure_code}</Alert> : null}
          <div className="row mt">
            {auth.can('sessions:operate') && live ? (
              <button
                type="button"
                className="danger"
                onClick={() =>
                  setConfirm({
                    title: t('sessions.stop'),
                    danger: true,
                    action: () => api.post(`/sessions/${id}/stop`),
                  })
                }
              >
                {t('sessions.stop')}
              </button>
            ) : null}
            {auth.can('sessions:operate') && ['AUTHORIZING', 'STARTING'].includes(s.state) ? (
              <button
                type="button"
                onClick={() =>
                  setConfirm({
                    title: t('sessions.cancel'),
                    action: () => api.post(`/sessions/${id}/cancel`),
                  })
                }
              >
                {t('sessions.cancel')}
              </button>
            ) : null}
            {auth.can('sessions:operate') && !live ? (
              <button
                type="button"
                onClick={() =>
                  setConfirm({
                    title: t('sessions.recalculate'),
                    action: (reason) => api.post(`/sessions/${id}/cost/recalculate`, { reason }),
                  })
                }
              >
                {t('sessions.recalculate')}
              </button>
            ) : null}
            {auth.can('sessions:operate') && s.state === 'ENDED' ? (
              <button
                type="button"
                onClick={() =>
                  setConfirm({
                    title: t('sessions.settle'),
                    action: () => api.post(`/sessions/${id}/settle`, { force: true }),
                  })
                }
              >
                {t('sessions.settle')}
              </button>
            ) : null}
            {auth.can('billing:operate') && s.state === 'SETTLED' && s.payment_status !== 'PAID' ? (
              <button
                type="button"
                onClick={() =>
                  setConfirm({
                    title: t('sessions.charge'),
                    action: () => api.post(`/sessions/${id}/charge`),
                  })
                }
              >
                {t('sessions.charge')}
              </button>
            ) : null}
            {auth.can('billing:read') && s.receipt_id ? (
              <button type="button" onClick={() => void openReceipt()}>
                {t('sessions.receipt')}
              </button>
            ) : null}
          </div>
        </div>
        <div className="card">
          <h2>{t('sessions.costBreakdown')}</h2>
          {cost.error ? <p className="muted small">{cost.error.message}</p> : null}
          {cost.data ? (
            <>
              <DataTable
                rows={cost.data.lines}
                rowKey={(l) => String(l.seq)}
                columns={[
                  { key: 'dim', header: t('sessions.line.dimension'), render: (l) => l.dimension },
                  {
                    key: 'period',
                    header: '',
                    render: (l) =>
                      l.periodStart
                        ? `${dateTime(l.periodStart, locale)} → ${dateTime(l.periodEnd, locale)}`
                        : '',
                    className: 'small',
                  },
                  {
                    key: 'qty',
                    header: t('sessions.line.quantity'),
                    render: (l) => `${l.quantity} ${l.unit}`,
                    align: 'right',
                  },
                  {
                    key: 'unit',
                    header: t('sessions.line.unitPrice'),
                    render: (l) => l.unitPrice,
                    align: 'right',
                  },
                  {
                    key: 'amount',
                    header: t('sessions.line.amount'),
                    render: (l) => l.total,
                    align: 'right',
                  },
                ]}
              />
              <div className="row between mt">
                <span className="muted">
                  {t('sessions.subtotal')} {cost.data.subtotal} · {t('sessions.discount')}{' '}
                  {cost.data.discount} · {t('sessions.tax')} {cost.data.tax}
                </span>
                <strong>
                  {t('sessions.total')}: {money(cost.data.totalMinor, cost.data.currency, locale)}
                </strong>
              </div>
              {cost.data.capped ? <Alert tone="warning">{t('sessions.exposure')}</Alert> : null}
              {cost.data.flags.length ? (
                <p className="small muted">{cost.data.flags.join(', ')}</p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <div className="card">
        <h2>{t('sessions.events')}</h2>
        <DataTable
          rows={s.events}
          rowKey={(e) => String(e.id)}
          columns={[
            { key: 'at', header: t('audit.when'), render: (e) => dateTime(e.occurred_at, locale) },
            { key: 'type', header: t('pay.event'), render: (e) => <code>{e.type}</code> },
            {
              key: 'payload',
              header: '',
              render: (e) => (
                <details>
                  <summary className="small muted">{t('app.details')}</summary>
                  <JsonView value={e.payload} />
                </details>
              ),
            },
          ]}
        />
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        danger={confirm?.danger}
        requireReason
        busy={mutation.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={run}
      />
    </>
  );
}
