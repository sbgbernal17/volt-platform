import { useRef, useState } from 'react';
import { useApi, useAuth } from '../auth/auth.tsx';
import { ConfirmDialog } from '../components/confirm-dialog.tsx';
import { DataTable } from '../components/data-table.tsx';
import {
  Alert,
  Badge,
  ErrorBox,
  JsonView,
  Kpi,
  Loading,
  PageHeader,
  PaymentBadge,
  Tabs,
} from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { dateTime, money, relativeTime } from '../lib/format.ts';
import { type Period, periodRange } from '../lib/payments-view.ts';
import { useRouter } from '../lib/router.tsx';
import type { Items } from '../lib/types.ts';
import { useMutation, useQuery } from '../lib/use-query.ts';

interface Payment {
  id: string;
  kind: string;
  status: string;
  psp: string;
  psp_status: string | null;
  psp_reference: string | null;
  psp_environment: string | null;
  reference: string | null;
  amount_minor: number | string;
  currency: string;
  session_id: string | null;
  driver_id: string | null;
  created_at: string;
  finalized_at: string | null;
  status_message: string | null;
  attempt: number;
}
interface Debt {
  id: string;
  status: string;
  driver_id: string;
  session_id: string | null;
  amount_minor: number | string;
  currency: string;
  attempts: number;
  next_attempt_at: string | null;
  payment_link_url: string | null;
  created_at: string;
}
interface Webhook {
  id: string;
  psp: string;
  event: string;
  dedupe_key: string;
  received_at: string;
  processed_at: string | null;
  outcome: string | null;
  checksum_valid: boolean;
}
interface Summary {
  from: string;
  to: string;
  environment: string | null;
  totals: {
    collectedMinor: number;
    collectedCount: number;
    refundedMinor: number;
    refundedCount: number;
    voidedMinor: number;
    pendingMinor: number;
    pendingCount: number;
    declinedMinor: number;
    declinedCount: number;
    errorCount: number;
    netMinor: number;
  };
  byDay: { day: string; collectedMinor: number; refundedMinor: number; count: number }[];
  byMethod: { method: string; collectedMinor: number; count: number }[];
  debts: { openCount: number; openMinor: number };
  sessions: { settledCount: number; billedMinor: number; paidMinor: number };
}
interface ProviderStatus {
  provider: string;
  environment: string;
  configured: boolean;
  health: { ok: boolean; latencyMs: number; merchant: string | null; error: string | null } | null;
  lastWebhookAt: string | null;
  lastWebhookOutcome: string | null;
  webhooks24h: { applied: number; invalidChecksum: number; other: number };
  lastCaptureAt: string | null;
  pending: { count: number; oldestAt: string | null };
  last24h: { approved: number; declined: number; errors: number };
  openReconciliationAlarms: number;
  unconfirmedSources: number;
  checkedAt: string;
}

type Tab = 'summary' | 'payments' | 'debts' | 'webhooks';
const PERIODS: Period[] = ['today', '7d', 'month', '30d'];
const STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED'];
const KINDS = ['CAPTURE', 'DEBT', 'VOID', 'REFUND'];

export function PaymentsPage() {
  const { t, td, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const [tab, setTab] = useState<Tab>('summary');
  const [period, setPeriod] = useState<Period>('month');
  const [filters, setFilters] = useState({ status: '', kind: '', from: '', to: '' });
  const range = periodRange(period);
  const summary = useQuery(
    () => api.get<Summary>('/billing/summary', { from: range.from, to: range.to }),
    [range.from, range.to],
    { refreshMs: 60_000, enabled: tab === 'summary' },
  );
  const provider = useQuery(() => api.get<ProviderStatus>('/billing/provider'), [], {
    refreshMs: 60_000,
    enabled: tab === 'summary',
  });
  const payments = useQuery(
    () =>
      api.get<Items<Payment>>('/payments', {
        limit: 200,
        status: filters.status || undefined,
        kind: filters.kind || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      }),
    [filters.status, filters.kind, filters.from, filters.to],
    { refreshMs: 15_000, enabled: tab === 'payments' },
  );
  const debts = useQuery(() => api.get<Items<Debt>>('/debts', { limit: 100 }), [], {
    refreshMs: 15_000,
    enabled: tab === 'debts',
  });
  const webhooks = useQuery(
    () => api.get<Items<Webhook>>('/billing/webhooks', { limit: 100 }),
    [],
    { enabled: tab === 'webhooks' },
  );
  const mutation = useMutation();
  const [confirm, setConfirm] = useState<{
    title: string;
    danger?: boolean;
    requireReason: boolean;
    reverse?: boolean;
    action: (reason: string) => Promise<unknown>;
  } | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [amount, setAmount] = useState('');
  // El importe parcial se lee al confirmar (no al abrir el diálogo), para no usar un valor viejo.
  const amountRef = useRef('');

  const firstError = summary.error ?? provider.error ?? payments.error ?? debts.error ?? null;
  const unavailable = (firstError as { code?: string } | null)?.code === 'PAYMENTS_UNAVAILABLE';
  const reloadAll = () => {
    void summary.reload();
    void provider.reload();
    void payments.reload();
    void debts.reload();
    void webhooks.reload();
  };
  const run = async (reason: string) => {
    if (!confirm) return;
    const action = confirm.action;
    setConfirm(null);
    const outcome = await mutation.run(() => action(reason));
    if (outcome !== undefined) setResult(outcome);
    reloadAll();
  };
  const cop = (minor: number | string | null | undefined) => money(minor, 'COP', locale);
  const providerReady = provider.data;

  return (
    <>
      <PageHeader
        title={t('pay.title')}
        actions={
          auth.can('billing:operate') ? (
            <>
              <button
                type="button"
                onClick={() =>
                  setConfirm({
                    title: t('pay.runJobs'),
                    requireReason: false,
                    action: () => api.post('/billing/jobs/run', { job: 'all' }),
                  })
                }
              >
                {t('pay.runJobs')}
              </button>
              <button
                type="button"
                onClick={() =>
                  setConfirm({
                    title: t('pay.reconcile'),
                    requireReason: false,
                    action: () => api.post('/billing/reconcile', {}),
                  })
                }
              >
                {t('pay.reconcile')}
              </button>
            </>
          ) : null
        }
      />
      {unavailable ? <Alert tone="warning">{t('pay.unavailable')}</Alert> : null}
      {!unavailable && firstError ? <ErrorBox error={firstError} /> : null}
      <ErrorBox error={mutation.error} />
      {result ? (
        <details className="card compact">
          <summary>{t('pay.outcome')}</summary>
          <JsonView value={result} />
        </details>
      ) : null}
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'summary', label: t('pay.summary') },
          { id: 'payments', label: t('pay.payments') },
          { id: 'debts', label: t('pay.debts') },
          { id: 'webhooks', label: t('pay.webhooks') },
        ]}
      />

      {tab === 'summary' ? (
        <>
          <div className="row between mb">
            <div className="row">
              <span className="muted small">{t('pay.period')}</span>
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={p === period ? 'primary small' : 'small'}
                  onClick={() => setPeriod(p)}
                >
                  {td(`pay.period.${p}`)}
                </button>
              ))}
            </div>
            <span className="muted small">
              {range.from} → {range.to}
              {summary.data?.environment ? ` · ${td(`pay.env.${summary.data.environment}`)}` : ''}
            </span>
          </div>
          {summary.loading && !summary.data ? <Loading /> : null}
          {summary.data ? (
            <>
              <div className="grid cols-3">
                <Kpi
                  label={t('pay.collected')}
                  value={cop(summary.data.totals.collectedMinor)}
                  sub={`${summary.data.totals.collectedCount} ${t('pay.count').toLowerCase()}`}
                />
                <Kpi
                  label={t('pay.refunded')}
                  value={cop(summary.data.totals.refundedMinor)}
                  sub={`${summary.data.totals.refundedCount} · ${t('pay.voided')} ${cop(summary.data.totals.voidedMinor)}`}
                />
                <Kpi label={t('pay.net')} value={cop(summary.data.totals.netMinor)} />
                <Kpi
                  label={t('pay.pending')}
                  value={cop(summary.data.totals.pendingMinor)}
                  sub={String(summary.data.totals.pendingCount)}
                />
                <Kpi
                  label={t('pay.declined')}
                  value={cop(summary.data.totals.declinedMinor)}
                  sub={`${summary.data.totals.declinedCount} · ${t('pay.errors')}: ${summary.data.totals.errorCount}`}
                />
                <Kpi
                  label={t('pay.openDebt')}
                  value={cop(summary.data.debts.openMinor)}
                  sub={String(summary.data.debts.openCount)}
                />
              </div>
              <p className="muted small">
                {t('pay.billed')}: {cop(summary.data.sessions.billedMinor)} (
                {summary.data.sessions.settledCount}) · {t('pay.paidSessions')}:{' '}
                {cop(summary.data.sessions.paidMinor)}
              </p>
              <div className="grid cols-2">
                <div className="card">
                  <h2>{t('pay.byDay')}</h2>
                  <DataTable
                    rows={[...summary.data.byDay].reverse()}
                    rowKey={(d) => d.day}
                    columns={[
                      { key: 'day', header: t('pay.day'), render: (d) => d.day },
                      {
                        key: 'n',
                        header: t('pay.count'),
                        render: (d) => d.count,
                        align: 'right',
                      },
                      {
                        key: 'c',
                        header: t('pay.collected'),
                        render: (d) => cop(d.collectedMinor),
                        align: 'right',
                      },
                      {
                        key: 'r',
                        header: t('pay.refunded'),
                        render: (d) => cop(d.refundedMinor),
                        align: 'right',
                      },
                    ]}
                  />
                </div>
                <div className="card">
                  <h2>{t('pay.byMethod')}</h2>
                  <DataTable
                    rows={summary.data.byMethod}
                    rowKey={(m) => m.method}
                    columns={[
                      {
                        key: 'm',
                        header: t('pay.method'),
                        render: (m) => td(`pay.method.${m.method}`),
                      },
                      {
                        key: 'n',
                        header: t('pay.count'),
                        render: (m) => m.count,
                        align: 'right',
                      },
                      {
                        key: 'c',
                        header: t('pay.collected'),
                        render: (m) => cop(m.collectedMinor),
                        align: 'right',
                      },
                    ]}
                  />
                </div>
              </div>
            </>
          ) : null}
          <div className="card">
            <h2>{t('pay.provider')}</h2>
            {provider.loading && !providerReady ? <Loading /> : null}
            {providerReady && !providerReady.configured ? (
              <p className="muted">{t('pay.providerNone')}</p>
            ) : null}
            {providerReady?.configured ? (
              <>
                <div className="row mb">
                  <Badge tone={providerReady.health?.ok ? 'ok' : 'danger'}>
                    {providerReady.health?.ok
                      ? t('pay.merchantOk', { latency: providerReady.health.latencyMs })
                      : t('pay.merchantFail', {
                          error: providerReady.health?.error ?? t('pay.never'),
                        })}
                  </Badge>
                  <Badge tone={providerReady.environment === 'production' ? 'ok' : 'warning'}>
                    {td(`pay.env.${providerReady.environment}`)}
                  </Badge>
                  {providerReady.health?.merchant ? (
                    <span className="muted small">{providerReady.health.merchant}</span>
                  ) : null}
                </div>
                <div className="grid cols-3">
                  <div>
                    <div className="muted small">{t('pay.lastCapture')}</div>
                    <span title={dateTime(providerReady.lastCaptureAt, locale)}>
                      {providerReady.lastCaptureAt
                        ? relativeTime(providerReady.lastCaptureAt, locale)
                        : t('pay.never')}
                    </span>
                  </div>
                  <div>
                    <div className="muted small">{t('pay.lastWebhook')}</div>
                    <span title={dateTime(providerReady.lastWebhookAt, locale)}>
                      {providerReady.lastWebhookAt
                        ? `${relativeTime(providerReady.lastWebhookAt, locale)} · ${providerReady.lastWebhookOutcome ?? ''}`
                        : t('pay.never')}
                    </span>
                  </div>
                  <div>
                    <div className="muted small">{t('pay.webhooks24h')}</div>
                    {providerReady.webhooks24h.applied} {t('pay.applied')} ·{' '}
                    {providerReady.webhooks24h.invalidChecksum} {t('pay.invalidChecksum')} ·{' '}
                    {providerReady.webhooks24h.other} {t('pay.otherOutcome')}
                  </div>
                  <div>
                    <div className="muted small">{t('pay.last24h')}</div>
                    {providerReady.last24h.approved} {t('pay.approved')} ·{' '}
                    {providerReady.last24h.declined} {t('pay.declinedShort')} ·{' '}
                    {providerReady.last24h.errors} {t('pay.errorsShort')}
                  </div>
                  <div>
                    <div className="muted small">{t('pay.pendingNow')}</div>
                    {providerReady.pending.count}
                    {providerReady.pending.oldestAt
                      ? ` · ${relativeTime(providerReady.pending.oldestAt, locale)}`
                      : ''}
                  </div>
                  <div>
                    <div className="muted small">{t('pay.reconAlarms')}</div>
                    <Badge tone={providerReady.openReconciliationAlarms ? 'warning' : 'ok'}>
                      {providerReady.openReconciliationAlarms}
                    </Badge>{' '}
                    <span className="muted small">
                      {t('pay.sourcesStuck')}: {providerReady.unconfirmedSources}
                    </span>
                  </div>
                </div>
                <p className="muted small mt">{t('pay.providerHelp')}</p>
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {tab === 'payments' ? (
        <div className="card">
          <div className="row mb">
            <select
              aria-label={t('pay.status')}
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">
                {t('pay.status')}: {t('app.all')}
              </option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              aria-label={t('pay.kind')}
              value={filters.kind}
              onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
            >
              <option value="">
                {t('pay.kind')}: {t('app.all')}
              </option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <label className="row small muted">
              {t('pay.from')}
              <input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              />
            </label>
            <label className="row small muted">
              {t('pay.to')}
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
            </label>
            <button type="button" className="small" onClick={() => void payments.reload()}>
              {t('app.refresh')}
            </button>
          </div>
          {payments.loading && !payments.data ? <Loading /> : null}
          <DataTable
            rows={payments.data?.items ?? []}
            rowKey={(p) => p.id}
            columns={[
              {
                key: 'at',
                header: t('app.created'),
                render: (p) => dateTime(p.finalized_at ?? p.created_at, locale),
              },
              {
                key: 'ref',
                header: t('pay.reference'),
                render: (p) => (
                  <>
                    <code>{p.reference ?? p.id.slice(0, 8)}</code>
                    {p.psp_reference ? (
                      <div className="small muted">
                        {t('pay.pspReference')}: <code>{p.psp_reference}</code>
                      </div>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'kind',
                header: t('pay.kind'),
                render: (p) => `${p.kind}${p.attempt > 1 ? ` #${p.attempt}` : ''}`,
              },
              {
                key: 'amount',
                header: t('pay.amount'),
                render: (p) => money(p.amount_minor, p.currency, locale),
                align: 'right',
              },
              {
                key: 'status',
                header: t('pay.status'),
                render: (p) => (
                  <>
                    <PaymentBadge value={p.status} />{' '}
                    {p.psp_status && p.psp_status !== p.status ? (
                      <span className="small muted">{p.psp_status}</span>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'psp',
                header: t('pay.psp'),
                render: (p) => `${p.psp}${p.psp_environment ? ` · ${p.psp_environment}` : ''}`,
              },
              {
                key: 'session',
                header: t('pay.session'),
                render: (p) =>
                  p.session_id ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() => navigate(`/sessions/${p.session_id}`)}
                    >
                      {p.session_id.slice(0, 8)}
                    </button>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'msg',
                header: '',
                render: (p) => <span className="small muted">{p.status_message ?? ''}</span>,
              },
              {
                key: 'act',
                header: '',
                render: (p) =>
                  auth.can('billing:refund') &&
                  p.status === 'SUCCEEDED' &&
                  p.psp_status === 'APPROVED' &&
                  p.kind !== 'REFUND' &&
                  p.kind !== 'VOID' ? (
                    <button
                      type="button"
                      className="small"
                      onClick={() => {
                        setAmount('');
                        amountRef.current = '';
                        setConfirm({
                          title: `${t('pay.reverse')} ${money(p.amount_minor, p.currency, locale)}`,
                          danger: true,
                          requireReason: true,
                          reverse: true,
                          action: (reason) =>
                            api.post(`/payments/${p.id}/reverse`, {
                              reason,
                              amountMinor: amountRef.current
                                ? Number(amountRef.current)
                                : undefined,
                            }),
                        });
                      }}
                    >
                      {t('pay.reverse')}
                    </button>
                  ) : null,
              },
            ]}
          />
        </div>
      ) : null}

      {tab === 'debts' ? (
        <div className="card">
          {debts.loading && !debts.data ? <Loading /> : null}
          <DataTable
            rows={debts.data?.items ?? []}
            rowKey={(d) => d.id}
            columns={[
              {
                key: 'at',
                header: t('app.created'),
                render: (d) => dateTime(d.created_at, locale),
              },
              {
                key: 'driver',
                header: t('pay.driver'),
                render: (d) => (
                  <button
                    type="button"
                    className="link"
                    onClick={() => navigate(`/drivers/${d.driver_id}`)}
                  >
                    {d.driver_id.slice(0, 8)}
                  </button>
                ),
              },
              {
                key: 'amount',
                header: t('pay.debtAmount'),
                render: (d) => money(d.amount_minor, d.currency, locale),
                align: 'right',
              },
              {
                key: 'status',
                header: t('pay.status'),
                render: (d) => <PaymentBadge value={d.status} />,
              },
              {
                key: 'attempts',
                header: t('pay.attempts'),
                render: (d) => d.attempts,
                align: 'right',
              },
              {
                key: 'next',
                header: t('pay.nextAttempt'),
                render: (d) => dateTime(d.next_attempt_at, locale),
              },
              {
                key: 'link',
                header: t('pay.payLink'),
                render: (d) =>
                  d.payment_link_url ? (
                    <a href={d.payment_link_url} target="_blank" rel="noreferrer">
                      {t('pay.payLink')}
                    </a>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'act',
                header: '',
                render: (d) =>
                  d.status === 'OPEN' ? (
                    <span className="row">
                      {auth.can('billing:operate') ? (
                        <button
                          type="button"
                          className="small"
                          onClick={() =>
                            setConfirm({
                              title: t('pay.createLink'),
                              requireReason: false,
                              action: () => api.post(`/debts/${d.id}/pay-link`),
                            })
                          }
                        >
                          {t('pay.createLink')}
                        </button>
                      ) : null}
                      {auth.can('billing:operate') ? (
                        <button
                          type="button"
                          className="small"
                          onClick={() =>
                            setConfirm({
                              title: t('pay.retry'),
                              requireReason: false,
                              action: () => api.post(`/debts/${d.id}/retry`),
                            })
                          }
                        >
                          {t('pay.retry')}
                        </button>
                      ) : null}
                      {auth.can('billing:refund') ? (
                        <button
                          type="button"
                          className="small"
                          onClick={() =>
                            setConfirm({
                              title: `${t('pay.waive')} ${money(d.amount_minor, d.currency, locale)}`,
                              danger: true,
                              requireReason: true,
                              action: (reason) => api.post(`/debts/${d.id}/waive`, { reason }),
                            })
                          }
                        >
                          {t('pay.waive')}
                        </button>
                      ) : null}
                    </span>
                  ) : null,
              },
            ]}
          />
        </div>
      ) : null}

      {tab === 'webhooks' ? (
        <div className="card">
          {webhooks.loading && !webhooks.data ? <Loading /> : null}
          <ErrorBox error={webhooks.error} />
          <DataTable
            rows={webhooks.data?.items ?? []}
            rowKey={(w) => w.id}
            columns={[
              {
                key: 'at',
                header: t('pay.received'),
                render: (w) => dateTime(w.received_at, locale),
              },
              { key: 'psp', header: t('pay.psp'), render: (w) => w.psp },
              { key: 'event', header: t('pay.event'), render: (w) => <code>{w.event}</code> },
              {
                key: 'key',
                header: 'dedupe',
                render: (w) => <code className="small">{w.dedupe_key}</code>,
              },
              {
                key: 'checksum',
                header: t('pay.checksum'),
                render: (w) => (w.checksum_valid ? t('app.yes') : t('app.no')),
              },
              { key: 'outcome', header: t('pay.outcome'), render: (w) => w.outcome ?? '—' },
            ]}
          />
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        danger={confirm?.danger}
        requireReason={confirm?.requireReason}
        busy={mutation.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={run}
      >
        {confirm?.reverse ? (
          <label className="field">
            <span>{t('pay.reverseAmount')}</span>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                amountRef.current = e.target.value;
              }}
            />
          </label>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
