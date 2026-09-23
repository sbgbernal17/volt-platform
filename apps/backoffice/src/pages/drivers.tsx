import { type FormEvent, useState } from 'react';
import { useApi, useAuth } from '../auth/auth.tsx';
import { ConfirmDialog } from '../components/confirm-dialog.tsx';
import { DataTable } from '../components/data-table.tsx';
import {
  Alert,
  Badge,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  PaymentBadge,
  SessionBadge,
} from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { dateTime, energyKwh, money } from '../lib/format.ts';
import { useRouter } from '../lib/router.tsx';
import type { Driver, Items, SessionView } from '../lib/types.ts';
import { useMutation, useQuery } from '../lib/use-query.ts';

function BillingBadge({ value }: { value: string }) {
  const { t } = useI18n();
  if (value === 'OK') return <Badge tone="ok">{t('drivers.ok')}</Badge>;
  if (value === 'BLOCKED_DEBT') return <Badge tone="danger">{t('drivers.blockedDebt')}</Badge>;
  return <Badge tone="warning">{t('drivers.blockedManual')}</Badge>;
}

export function DriversPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const drivers = useQuery(() => api.get<Items<Driver>>('/drivers'), []);
  const mutation = useMutation();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: '', phone: '', displayName: '' });
  const [filter, setFilter] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void mutation
      .run(() =>
        api.post<Driver>('/drivers', {
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          displayName: form.displayName.trim() || undefined,
        }),
      )
      .then((created) => {
        if (created) {
          setCreating(false);
          setForm({ email: '', phone: '', displayName: '' });
          void drivers.reload();
        }
      });
  };
  const rows = (drivers.data?.items ?? []).filter(
    (d) =>
      !filter ||
      `${d.email ?? ''} ${d.display_name ?? ''} ${d.phone ?? ''}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title={t('drivers.title')}
        actions={
          <>
            <input
              placeholder={t('app.search')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ width: 220 }}
            />
            {auth.can('drivers:write') ? (
              <button type="button" className="primary" onClick={() => setCreating((v) => !v)}>
                {t('drivers.new')}
              </button>
            ) : null}
          </>
        }
      />
      {creating ? (
        <form className="card" onSubmit={submit}>
          <ErrorBox error={mutation.error} />
          <div className="grid cols-3">
            <Field label={t('drivers.email')}>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label={t('drivers.phone')}>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label={t('drivers.name')}>
              <input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
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
        <ErrorBox error={drivers.error} />
        {drivers.loading ? <Loading /> : null}
        <DataTable
          rows={rows}
          rowKey={(d) => d.id}
          onRowClick={(d) => navigate(`/drivers/${d.id}`)}
          columns={[
            {
              key: 'name',
              header: t('drivers.name'),
              render: (d) => <strong>{d.display_name ?? '—'}</strong>,
            },
            { key: 'email', header: t('drivers.email'), render: (d) => d.email ?? '—' },
            { key: 'phone', header: t('drivers.phone'), render: (d) => d.phone ?? '—' },
            { key: 'segment', header: t('drivers.segment'), render: (d) => d.segment },
            { key: 'status', header: t('app.status'), render: (d) => d.status },
            {
              key: 'billing',
              header: t('drivers.billing'),
              render: (d) => <BillingBadge value={d.billing_status} />,
            },
            {
              key: 'created',
              header: t('app.created'),
              render: (d) => dateTime(d.created_at, locale),
            },
          ]}
        />
      </div>
    </>
  );
}

interface DriverDetail extends Driver {
  paymentMethods: {
    id: string;
    type: string;
    label: string | null;
    status: string;
    psp_source_status: string;
    is_default?: boolean;
    created_at: string;
  }[];
  sessions: SessionView[];
  debts: {
    id: string;
    status: string;
    amount_minor: number | string;
    currency: string;
    attempts: number;
    created_at: string;
    payment_link_url: string | null;
  }[];
}

export function DriverDetailPage({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const driver = useQuery(() => api.get<DriverDetail>(`/drivers/${id}`), [id]);
  const mutation = useMutation();
  const [confirm, setConfirm] = useState<{
    title: string;
    danger?: boolean;
    action: (reason: string) => Promise<unknown>;
  } | null>(null);
  if (driver.error && !driver.data) return <ErrorBox error={driver.error} />;
  if (!driver.data) return <Loading />;
  const d = driver.data;
  const blocked = d.billing_status !== 'OK';
  return (
    <>
      <PageHeader
        title={d.display_name ?? d.email ?? d.id.slice(0, 8)}
        actions={
          <>
            <BillingBadge value={d.billing_status} />
            {auth.can('billing:operate') ? (
              blocked ? (
                <button
                  type="button"
                  onClick={() =>
                    setConfirm({
                      title: t('drivers.unblock'),
                      action: (reason) => api.post(`/drivers/${id}/unblock`, { reason }),
                    })
                  }
                >
                  {t('drivers.unblock')}
                </button>
              ) : (
                <button
                  type="button"
                  className="danger"
                  onClick={() =>
                    setConfirm({
                      title: t('drivers.block'),
                      danger: true,
                      action: (reason) => api.post(`/drivers/${id}/block`, { reason }),
                    })
                  }
                >
                  {t('drivers.block')}
                </button>
              )
            ) : null}
            <button type="button" onClick={() => navigate('/drivers')}>
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
              <div className="muted small">{t('drivers.email')}</div>
              {d.email ?? '—'}
            </div>
            <div>
              <div className="muted small">{t('drivers.phone')}</div>
              {d.phone ?? '—'}
            </div>
            <div>
              <div className="muted small">{t('drivers.segment')}</div>
              {d.segment}
            </div>
            <div>
              <div className="muted small">{t('app.status')}</div>
              {d.status}
            </div>
            <div>
              <div className="muted small">{t('app.created')}</div>
              {dateTime(d.created_at, locale)}
            </div>
            {d.blocked_reason ? (
              <div>
                <div className="muted small">{t('app.reason')}</div>
                {d.blocked_reason}
              </div>
            ) : null}
          </div>
        </div>
        <div className="card">
          <h2>{t('drivers.paymentMethods')}</h2>
          <DataTable
            rows={d.paymentMethods}
            rowKey={(m) => m.id}
            columns={[
              {
                key: 'label',
                header: t('pay.kind'),
                render: (m) => `${m.type} · ${m.label ?? ''}`,
              },
              {
                key: 'status',
                header: t('app.status'),
                render: (m) => <PaymentBadge value={m.psp_source_status ?? m.status} />,
              },
              {
                key: 'created',
                header: t('app.created'),
                render: (m) => dateTime(m.created_at, locale),
              },
            ]}
          />
          <h2 className="mt">{t('drivers.debts')}</h2>
          <DataTable
            rows={d.debts}
            rowKey={(x) => x.id}
            onRowClick={() => navigate('/payments')}
            columns={[
              {
                key: 'amount',
                header: t('pay.debtAmount'),
                render: (x) => money(x.amount_minor, x.currency, locale),
                align: 'right',
              },
              {
                key: 'status',
                header: t('app.status'),
                render: (x) => <PaymentBadge value={x.status} />,
              },
              {
                key: 'attempts',
                header: t('pay.attempts'),
                render: (x) => x.attempts,
                align: 'right',
              },
              {
                key: 'created',
                header: t('app.created'),
                render: (x) => dateTime(x.created_at, locale),
              },
            ]}
          />
        </div>
      </div>
      <div className="card">
        <h2>{t('drivers.sessions')}</h2>
        <DataTable
          rows={d.sessions}
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
              render: (s) => money(s.total_minor, s.currency ?? 'COP', locale),
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
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        danger={confirm?.danger}
        requireReason
        busy={mutation.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async (reason) => {
          const action = confirm?.action;
          setConfirm(null);
          if (action) {
            await mutation.run(() => action(reason));
            void driver.reload();
          }
        }}
      />
    </>
  );
}
