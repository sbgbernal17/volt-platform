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
  PaymentBadge,
  Tabs,
} from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { dateTime, money } from '../lib/format.ts';
import { useRouter } from '../lib/router.tsx';
import type { Items } from '../lib/types.ts';
import { useMutation, useQuery } from '../lib/use-query.ts';

interface Payment {
  id: string;
  kind: string;
  status: string;
  psp: string;
  psp_status: string | null;
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

type Tab = 'payments' | 'debts' | 'webhooks';

export function PaymentsPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const [tab, setTab] = useState<Tab>('payments');
  const payments = useQuery(() => api.get<Items<Payment>>('/payments', { limit: 100 }), [], {
    refreshMs: 15_000,
    enabled: tab === 'payments',
  });
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
    action: (reason: string) => Promise<unknown>;
  } | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [amount, setAmount] = useState('');

  const unavailable = (payments.error as { code?: string } | null)?.code === 'PAYMENTS_UNAVAILABLE';
  const reloadAll = () => {
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
          { id: 'payments', label: t('pay.payments') },
          { id: 'debts', label: t('pay.debts') },
          { id: 'webhooks', label: t('pay.webhooks') },
        ]}
      />
      {tab === 'payments' ? (
        <div className="card">
          {payments.loading ? <Loading /> : null}
          <DataTable
            rows={payments.data?.items ?? []}
            rowKey={(p) => p.id}
            columns={[
              {
                key: 'at',
                header: t('app.created'),
                render: (p) => dateTime(p.created_at, locale),
              },
              {
                key: 'ref',
                header: t('pay.reference'),
                render: (p) => <code>{p.reference ?? p.id.slice(0, 8)}</code>,
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
              { key: 'psp', header: t('pay.psp'), render: (p) => p.psp },
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
                  (p.status === 'CAPTURED' || p.status === 'PAID' || p.psp_status === 'APPROVED') &&
                  p.kind !== 'REFUND' &&
                  p.kind !== 'VOID' ? (
                    <button
                      type="button"
                      className="small"
                      onClick={() => {
                        setAmount('');
                        setConfirm({
                          title: `${t('pay.reverse')} ${money(p.amount_minor, p.currency, locale)}`,
                          danger: true,
                          requireReason: true,
                          action: (reason) =>
                            api.post(`/payments/${p.id}/reverse`, {
                              reason,
                              amountMinor: amount ? Number(amount) : undefined,
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
          {debts.loading ? <Loading /> : null}
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
          {webhooks.loading ? <Loading /> : null}
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
        {confirm?.title.startsWith(t('pay.reverse')) ? (
          <label className="field">
            <span>{t('pay.reverseAmount')}</span>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
