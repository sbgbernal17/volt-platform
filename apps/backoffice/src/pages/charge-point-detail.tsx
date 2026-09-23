import { type FormEvent, useState } from 'react';
import { useApi, useAuth } from '../auth/auth.tsx';
import { ConfirmDialog } from '../components/confirm-dialog.tsx';
import { DataTable } from '../components/data-table.tsx';
import {
  Alert,
  Badge,
  Copyable,
  ErrorBox,
  Field,
  JsonView,
  LifecycleBadge,
  Loading,
  PageHeader,
  SessionBadge,
  SeverityBadge,
  StatusBadge,
  Tabs,
} from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { dateTime, energyKwh, money, powerKw, relativeTime } from '../lib/format.ts';
import { useRouter } from '../lib/router.tsx';
import type {
  Alarm,
  ChargePoint,
  CommandRow,
  ConfigEntry,
  Connector,
  Items,
  SessionView,
} from '../lib/types.ts';
import { useMutation, useQuery } from '../lib/use-query.ts';
import { LIFECYCLE_STATES } from './charge-points.tsx';

interface ChargePointDetail extends ChargePoint {
  connectors: (Connector & { live_status: string })[];
  credential: {
    issued_at: string;
    issued_by: string;
    expires_at: string;
    bootstrap: boolean;
    first_used_at: string | null;
    last_used_at: string | null;
  } | null;
  configuration: ConfigEntry[];
  drift: string[];
  lifecycle_events: {
    id: number;
    from_state: string | null;
    to_state: string;
    actor: string;
    reason: string | null;
    at: string;
  }[];
  alarms: Alarm[];
}

interface TimelineEntry {
  kind: string;
  at: string;
  title: string;
  ref: string;
  details: Record<string, unknown>;
}

type Tab = 'overview' | 'configuration' | 'commands' | 'sessions' | 'timeline' | 'alarms';

const COMMANDS: {
  action: string;
  payload: Record<string, unknown>;
  sensitive: boolean;
  support: boolean;
}[] = [
  {
    action: 'TriggerMessage',
    payload: { requestedMessage: 'StatusNotification' },
    sensitive: false,
    support: true,
  },
  { action: 'GetConfiguration', payload: {}, sensitive: false, support: false },
  { action: 'ClearCache', payload: {}, sensitive: false, support: false },
  { action: 'UnlockConnector', payload: { connectorId: 1 }, sensitive: true, support: true },
  {
    action: 'RemoteStopTransaction',
    payload: { transactionId: 0 },
    sensitive: true,
    support: true,
  },
  { action: 'Reset', payload: { type: 'Soft' }, sensitive: true, support: false },
  {
    action: 'ChangeAvailability',
    payload: { connectorId: 0, type: 'Inoperative' },
    sensitive: true,
    support: false,
  },
  {
    action: 'ChangeConfiguration',
    payload: { key: 'HeartbeatInterval', value: '300' },
    sensitive: true,
    support: false,
  },
];

const TIMELINE_KINDS = ['OCPP', 'COMMAND', 'ALARM', 'LIFECYCLE', 'SESSION', 'CONNECTION'] as const;

export function ChargePointDetailPage({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const detail = useQuery(() => api.get<ChargePointDetail>(`/charge-points/${id}`), [id], {
    refreshMs: tab === 'overview' ? 10_000 : undefined,
  });
  const mutation = useMutation();
  const [credential, setCredential] = useState<{
    chargeBoxId: string;
    authorizationKey: string;
    expiresAt: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message?: string | undefined;
    danger?: boolean | undefined;
    requireReason: boolean;
    action: (reason: string) => Promise<unknown>;
  } | null>(null);

  const canCommission = auth.can('commissioning:execute');
  const canCommand = auth.can('commands:execute') || auth.can('commands:support');

  const act = (
    title: string,
    action: (reason: string) => Promise<unknown>,
    options: { message?: string; danger?: boolean; requireReason?: boolean } = {},
  ) =>
    setConfirm({
      title,
      action,
      message: options.message,
      danger: options.danger,
      requireReason: options.requireReason ?? true,
    });

  const runConfirmed = async (reason: string) => {
    if (!confirm) return;
    const action = confirm.action;
    setConfirm(null);
    await mutation.run(() => action(reason));
    void detail.reload();
  };

  if (detail.error && !detail.data) return <ErrorBox error={detail.error} />;
  if (!detail.data) return <Loading />;
  const cp = detail.data;
  const csmsUrl = `wss://ocpp.supercargadores.co/ocpp/${cp.charge_box_id}`;

  return (
    <>
      <PageHeader
        title={cp.charge_box_id}
        actions={
          <>
            <LifecycleBadge value={cp.lifecycle_status} />
            <Badge tone={cp.connected ? 'ok' : 'danger'}>
              {cp.connected ? t('cp.connected') : t('cp.disconnected')}
            </Badge>
            <button type="button" onClick={() => navigate('/charge-points')}>
              {t('app.back')}
            </button>
          </>
        }
      />
      <ErrorBox error={mutation.error} />
      {mutation.message ? <Alert tone="ok">{mutation.message}</Alert> : null}
      {credential ? (
        <Alert tone="warning">
          <strong>{t('cp.credentialTitle')}</strong>
          <p className="mt">
            {t('cp.credentialHelp')} <code>{csmsUrl}</code>
          </p>
          <p>
            <Copyable value={credential.authorizationKey} />
          </p>
          <p className="small">
            {t('cp.credentialExpires')}: {dateTime(credential.expiresAt, locale)}
          </p>
          <button type="button" className="small" onClick={() => setCredential(null)}>
            {t('app.close')}
          </button>
        </Alert>
      ) : null}
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: t('cp.tab.overview') },
          {
            id: 'configuration',
            label: `${t('cp.tab.configuration')}${cp.drift.length ? ` (${cp.drift.length})` : ''}`,
          },
          { id: 'commands', label: t('cp.tab.commands') },
          { id: 'sessions', label: t('cp.tab.sessions') },
          { id: 'timeline', label: t('cp.tab.timeline') },
          {
            id: 'alarms',
            label: `${t('cp.tab.alarms')}${cp.alarms.length ? ` (${cp.alarms.length})` : ''}`,
          },
        ]}
      />

      {tab === 'overview' ? (
        <>
          <div className="grid cols-2">
            <div className="card">
              <h2>{t('app.details')}</h2>
              <div className="grid cols-2">
                <div>
                  <div className="muted small">
                    {t('cp.vendor')} / {t('cp.model')}
                  </div>
                  {[cp.vendor, cp.model].filter(Boolean).join(' ') || '—'}
                </div>
                <div>
                  <div className="muted small">{t('cp.serial')}</div>
                  {cp.serial_number ?? '—'}
                </div>
                <div>
                  <div className="muted small">{t('cp.firmware')}</div>
                  {cp.firmware_version ?? '—'}
                </div>
                <div>
                  <div className="muted small">{t('cp.securityProfile')}</div>
                  {cp.security_profile}
                </div>
                <div>
                  <div className="muted small">{t('cp.heartbeat')}</div>
                  {cp.heartbeat_interval_s}
                </div>
                <div>
                  <div className="muted small">{t('cp.lastSeen')}</div>
                  <span title={dateTime(cp.last_seen_at, locale)}>
                    {relativeTime(cp.last_seen_at, locale)}
                  </span>
                </div>
                <div>
                  <div className="muted small">{t('cp.visibleInApp')}</div>
                  {cp.visible_in_app ? t('app.yes') : t('app.no')}
                </div>
                <div>
                  <div className="muted small">{t('cp.credential')}</div>
                  {cp.credential
                    ? `${t('cp.credentialIssued')} ${dateTime(cp.credential.issued_at, locale)}`
                    : t('cp.credentialNone')}
                </div>
              </div>
            </div>
            <div className="card">
              <h2>{t('cp.commissioning')}</h2>
              <div className="row">
                {canCommission ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={() =>
                      act(
                        t('cp.issueCredential'),
                        async () => {
                          const issued = await api.post<{
                            chargeBoxId: string;
                            authorizationKey: string;
                            expiresAt: string;
                          }>(`/charge-points/${id}/credentials`);
                          setCredential(issued);
                        },
                        { requireReason: false },
                      )
                    }
                  >
                    {t('cp.issueCredential')}
                  </button>
                ) : null}
                {canCommission ? (
                  <button
                    type="button"
                    onClick={() =>
                      act(
                        t('cp.applyTemplate'),
                        () => api.post(`/charge-points/${id}/commission`),
                        { requireReason: false },
                      )
                    }
                  >
                    {t('cp.applyTemplate')}
                  </button>
                ) : null}
                {canCommission ? (
                  <button
                    type="button"
                    onClick={() =>
                      act(
                        t('cp.syncConfig'),
                        () => api.post(`/charge-points/${id}/configuration/sync`),
                        { requireReason: false },
                      )
                    }
                  >
                    {t('cp.syncConfig')}
                  </button>
                ) : null}
              </div>
              {auth.can('inventory:write') ? (
                <LifecycleForm
                  current={cp.lifecycle_status}
                  onSubmit={(to, reason) =>
                    void mutation
                      .run(() =>
                        api.post(`/charge-points/${id}/lifecycle`, {
                          to,
                          reason: reason || undefined,
                        }),
                      )
                      .then(() => void detail.reload())
                  }
                />
              ) : null}
              <p className="small muted mt">
                {t('cp.credentialHelp')} <code>{csmsUrl}</code>
              </p>
            </div>
          </div>
          <div className="card">
            <h2>{t('cp.connectors')}</h2>
            <DataTable
              rows={cp.connectors}
              rowKey={(c) => c.id}
              columns={[
                { key: 'n', header: '#', render: (c) => c.ocpp_connector_id },
                { key: 'evse', header: 'EVSE', render: (c) => <code>{c.evse_code}</code> },
                {
                  key: 'std',
                  header: t('cp.standard'),
                  render: (c) => `${c.standard} · ${c.power_type}`,
                },
                {
                  key: 'power',
                  header: t('cp.maxPower'),
                  render: (c) => powerKw(c.max_power_w, locale),
                  align: 'right',
                },
                {
                  key: 'status',
                  header: t('app.status'),
                  render: (c) => (
                    <StatusBadge
                      status={c.live_status ?? c.ocpp_status ?? 'Unavailable'}
                      connected={cp.connected}
                    />
                  ),
                },
                { key: 'err', header: 'errorCode', render: (c) => c.error_code },
                {
                  key: 'at',
                  header: t('app.updated'),
                  render: (c) => dateTime(c.status_received_at, locale),
                },
              ]}
            />
          </div>
          <div className="card">
            <h2>{t('cp.lifecycle')}</h2>
            <DataTable
              rows={cp.lifecycle_events}
              rowKey={(e) => String(e.id)}
              columns={[
                { key: 'at', header: t('audit.when'), render: (e) => dateTime(e.at, locale) },
                {
                  key: 'from',
                  header: '',
                  render: (e) => (e.from_state ? <LifecycleBadge value={e.from_state} /> : '—'),
                },
                { key: 'to', header: '→', render: (e) => <LifecycleBadge value={e.to_state} /> },
                { key: 'actor', header: t('audit.actor'), render: (e) => <code>{e.actor}</code> },
                { key: 'reason', header: t('app.reason'), render: (e) => e.reason ?? '—' },
              ]}
            />
          </div>
        </>
      ) : null}

      {tab === 'configuration' ? (
        <div className="card">
          <div className="row between mb">
            <h2>{t('cp.tab.configuration')}</h2>
            {cp.drift.length ? (
              <Badge tone="warning">
                {t('cp.drift')}: {cp.drift.join(', ')}
              </Badge>
            ) : (
              <Badge tone="ok">{t('cp.noDrift')}</Badge>
            )}
          </div>
          <DataTable
            rows={cp.configuration}
            rowKey={(c) => c.key}
            columns={[
              { key: 'key', header: t('cp.key'), render: (c) => <code>{c.key}</code> },
              {
                key: 'desired',
                header: t('cp.desired'),
                render: (c) => <code>{c.desired_value ?? '—'}</code>,
              },
              {
                key: 'observed',
                header: t('cp.observed'),
                render: (c) => <code>{c.observed_value ?? '—'}</code>,
              },
              {
                key: 'ro',
                header: t('cp.readonly'),
                render: (c) =>
                  c.readonly ? t('app.yes') : c.readonly === false ? t('app.no') : '—',
              },
              {
                key: 'drift',
                header: t('cp.drift'),
                render: (c) => (c.drift ? <Badge tone="warning">{t('app.yes')}</Badge> : '—'),
              },
              {
                key: 'act',
                header: '',
                render: (c) =>
                  auth.can('config:write') && !c.readonly ? (
                    <button
                      type="button"
                      className="small"
                      onClick={() => {
                        const value = window.prompt(
                          `${t('cp.overrideValue')} (${c.key})`,
                          c.desired_value ?? '',
                        );
                        if (value === null) return;
                        act(
                          `${t('cp.override')}: ${c.key}`,
                          () =>
                            api.put(
                              `/charge-points/${id}/configuration/${encodeURIComponent(c.key)}`,
                              { value },
                            ),
                          { message: `${c.key} = ${value}` },
                        );
                      }}
                    >
                      {t('cp.override')}
                    </button>
                  ) : null,
              },
            ]}
          />
        </div>
      ) : null}

      {tab === 'commands' ? (
        <CommandsTab
          chargePointId={id}
          canCommand={canCommand}
          supportOnly={!auth.can('commands:execute')}
          onSent={() => void detail.reload()}
        />
      ) : null}
      {tab === 'sessions' ? <SessionsTab chargePointId={id} /> : null}
      {tab === 'timeline' ? <TimelineTab chargePointId={id} /> : null}
      {tab === 'alarms' ? (
        <div className="card">
          <DataTable
            rows={cp.alarms}
            rowKey={(a) => a.id}
            onRowClick={() => navigate('/alarms')}
            columns={[
              {
                key: 'sev',
                header: t('alarms.severity'),
                render: (a) => <SeverityBadge value={a.severity} />,
              },
              { key: 'kind', header: t('alarms.kind'), render: (a) => a.kind },
              { key: 'status', header: t('app.status'), render: (a) => a.status },
              {
                key: 'n',
                header: t('alarms.occurrences'),
                render: (a) => a.occurrences,
                align: 'right',
              },
              {
                key: 'last',
                header: t('alarms.lastSeen'),
                render: (a) => dateTime(a.last_seen_at, locale),
              },
            ]}
          />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message}
        danger={confirm?.danger}
        requireReason={confirm?.requireReason}
        busy={mutation.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={runConfirmed}
      />
    </>
  );
}

function LifecycleForm({
  current,
  onSubmit,
}: {
  current: string;
  onSubmit: (to: string, reason: string) => void;
}) {
  const { t } = useI18n();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  return (
    <form
      className="row mt"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (to) onSubmit(to, reason);
      }}
    >
      <select value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 200 }}>
        <option value="">{t('cp.lifecycleTo')}</option>
        {LIFECYCLE_STATES.filter((s) => s !== current).map((s) => (
          <option key={s} value={s}>
            {t(`lifecycle.${s}`)}
          </option>
        ))}
      </select>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('app.reason')}
        style={{ width: 220 }}
        maxLength={500}
      />
      <button type="submit" disabled={!to}>
        {t('cp.lifecycleChange')}
      </button>
    </form>
  );
}

function CommandsTab({
  chargePointId,
  canCommand,
  supportOnly,
  onSent,
}: {
  chargePointId: string;
  canCommand: boolean;
  supportOnly: boolean;
  onSent: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useApi();
  const history = useQuery(
    () => api.get<Items<CommandRow>>(`/charge-points/${chargePointId}/commands`),
    [chargePointId],
    { refreshMs: 10_000 },
  );
  const mutation = useMutation();
  const [action, setAction] = useState('TriggerMessage');
  const [payload, setPayload] = useState(JSON.stringify(COMMANDS[0]?.payload ?? {}, null, 2));
  const [result, setResult] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const definition = COMMANDS.find((c) => c.action === action);
  const available = COMMANDS.filter((c) => !supportOnly || c.support);

  const send = async (reason: string) => {
    setConfirm(false);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload || '{}') as Record<string, unknown>;
    } catch {
      mutation.clear();
      setResult({ error: 'JSON inválido' });
      return;
    }
    const outcome = await mutation.run(
      () =>
        api.post(`/charge-points/${chargePointId}/commands`, {
          action,
          payload: parsed,
          reason: reason || undefined,
        }),
      t('cp.commandOk'),
    );
    if (outcome !== undefined) {
      setResult(outcome);
      void history.reload();
      onSent();
    }
  };

  return (
    <>
      {canCommand ? (
        <div className="card">
          <h2>{t('cp.sendCommand')}</h2>
          <ErrorBox error={mutation.error} />
          {mutation.error &&
          (mutation.error as { code?: string }).code === 'GATEWAY_UNAVAILABLE' ? (
            <Alert tone="warning">{t('cp.gatewayUnavailable')}</Alert>
          ) : null}
          {mutation.message ? <Alert tone="ok">{mutation.message}</Alert> : null}
          <div className="grid cols-2">
            <Field label={t('cp.command')}>
              <select
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setPayload(
                    JSON.stringify(
                      COMMANDS.find((c) => c.action === e.target.value)?.payload ?? {},
                      null,
                      2,
                    ),
                  );
                }}
              >
                {available.map((c) => (
                  <option key={c.action} value={c.action}>
                    {c.action}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('cp.commandPayload')}>
              <textarea value={payload} onChange={(e) => setPayload(e.target.value)} rows={5} />
            </Field>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className={definition?.sensitive ? 'danger' : 'primary'}
              disabled={mutation.busy}
              onClick={() => (definition?.sensitive ? setConfirm(true) : void send(''))}
            >
              {t('cp.sendCommand')}
            </button>
          </div>
          {result ? (
            <>
              <h3>{t('cp.commandResult')}</h3>
              <JsonView value={result} />
            </>
          ) : null}
          <ConfirmDialog
            open={confirm}
            title={`${t('cp.sendCommand')}: ${action}`}
            message={t('cp.commandSensitive')}
            danger
            requireReason
            busy={mutation.busy}
            onCancel={() => setConfirm(false)}
            onConfirm={send}
          />
        </div>
      ) : null}
      <div className="card">
        <h2>{t('cp.commandHistory')}</h2>
        {(history.error as { code?: string } | null)?.code === 'GATEWAY_UNAVAILABLE' ? (
          <Alert tone="warning">{t('cp.gatewayUnavailable')}</Alert>
        ) : (
          <ErrorBox error={history.error} />
        )}
        <DataTable
          rows={history.data?.items ?? []}
          rowKey={(c) => c.id}
          columns={[
            { key: 'at', header: t('audit.when'), render: (c) => dateTime(c.requested_at, locale) },
            { key: 'action', header: t('cp.command'), render: (c) => <strong>{c.action}</strong> },
            {
              key: 'payload',
              header: t('cp.commandPayload'),
              render: (c) => <code>{JSON.stringify(c.payload)}</code>,
            },
            {
              key: 'state',
              header: t('app.status'),
              render: (c) => (
                <Badge
                  tone={
                    c.state === 'ACCEPTED'
                      ? 'ok'
                      : c.state === 'REJECTED' || c.state === 'ERROR' || c.state === 'TIMEOUT'
                        ? 'danger'
                        : 'info'
                  }
                >
                  {c.state}
                  {c.result_status ? ` · ${c.result_status}` : ''}
                </Badge>
              ),
            },
            { key: 'by', header: t('audit.actor'), render: (c) => <code>{c.requested_by}</code> },
            { key: 'err', header: '', render: (c) => c.error_description ?? c.error_code ?? '' },
          ]}
        />
      </div>
    </>
  );
}

function SessionsTab({ chargePointId }: { chargePointId: string }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const { navigate } = useRouter();
  const sessions = useQuery(
    () => api.get<Items<SessionView>>('/sessions', { chargePointId, limit: 50 }),
    [chargePointId],
    { refreshMs: 10_000 },
  );
  const transactions = useQuery(
    () =>
      api.get<
        Items<{
          id: string;
          ocpp_transaction_id: number;
          state: string;
          ocpp_connector_id: number;
          id_tag: string;
          meter_start_wh: number;
          meter_stop_wh: number | null;
          started_at_cp: string;
          stopped_at_cp: string | null;
          stop_reason: string | null;
          session_id: string | null;
        }>
      >(`/charge-points/${chargePointId}/transactions`),
    [chargePointId],
  );
  return (
    <>
      <div className="card">
        <h2>{t('sessions.title')}</h2>
        <ErrorBox error={sessions.error} />
        <DataTable
          rows={sessions.data?.items ?? []}
          rowKey={(s) => s.id}
          onRowClick={(s) => navigate(`/sessions/${s.id}`)}
          columns={[
            { key: 'no', header: t('sessions.no'), render: (s) => s.session_no },
            { key: 'evse', header: t('sessions.evse'), render: (s) => <code>{s.evse_code}</code> },
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
              render: (s) =>
                money(s.total_minor ?? s.running_cost?.total_minor, s.currency ?? 'COP', locale),
              align: 'right',
            },
          ]}
        />
      </div>
      <div className="card">
        <h2>{t('cp.transactions')}</h2>
        {transactions.error ? <ErrorBox error={transactions.error} /> : null}
        <DataTable
          rows={transactions.data?.items ?? []}
          rowKey={(x) => x.id}
          columns={[
            { key: 'id', header: 'transactionId', render: (x) => x.ocpp_transaction_id },
            { key: 'conn', header: t('cp.connector'), render: (x) => `#${x.ocpp_connector_id}` },
            { key: 'state', header: t('app.status'), render: (x) => x.state },
            {
              key: 'meter',
              header: 'meterStart → meterStop (Wh)',
              render: (x) => `${x.meter_start_wh} → ${x.meter_stop_wh ?? '…'}`,
            },
            {
              key: 'start',
              header: t('sessions.started'),
              render: (x) => dateTime(x.started_at_cp, locale),
            },
            {
              key: 'stop',
              header: t('sessions.ended'),
              render: (x) =>
                `${dateTime(x.stopped_at_cp, locale)}${x.stop_reason ? ` (${x.stop_reason})` : ''}`,
            },
          ]}
        />
      </div>
    </>
  );
}

function TimelineTab({ chargePointId }: { chargePointId: string }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const [kinds, setKinds] = useState<string[]>([
    'COMMAND',
    'ALARM',
    'LIFECYCLE',
    'SESSION',
    'CONNECTION',
  ]);
  const timeline = useQuery(
    () =>
      api.get<{ items: TimelineEntry[] }>(`/charge-points/${chargePointId}/timeline`, {
        kinds: kinds.join(','),
        limit: 300,
      }),
    [chargePointId, kinds.join(',')],
    { refreshMs: 15_000 },
  );
  return (
    <div className="card">
      <div className="row mb">
        <span className="muted small">{t('cp.timelineKinds')}:</span>
        {TIMELINE_KINDS.map((kind) => (
          <label key={kind} className="check small">
            <input
              type="checkbox"
              checked={kinds.includes(kind)}
              onChange={(e) =>
                setKinds(e.target.checked ? [...kinds, kind] : kinds.filter((k) => k !== kind))
              }
            />
            {kind}
          </label>
        ))}
      </div>
      <ErrorBox error={timeline.error} />
      {timeline.loading ? <Loading /> : null}
      <ul className="timeline">
        {(timeline.data?.items ?? []).map((entry) => (
          <li key={`${entry.kind}-${entry.ref}-${entry.at}`}>
            <span className="small muted">{dateTime(entry.at, locale)}</span>
            <Badge
              tone={
                entry.kind === 'ALARM'
                  ? 'warning'
                  : entry.kind === 'COMMAND'
                    ? 'info'
                    : entry.kind === 'SESSION'
                      ? 'primary'
                      : 'neutral'
              }
            >
              {entry.kind}
            </Badge>
            <details>
              <summary>
                <strong>{entry.title}</strong>{' '}
                <span className="muted small">{summaryOf(entry)}</span>
              </summary>
              <JsonView value={entry.details} />
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

function summaryOf(entry: TimelineEntry): string {
  const d = entry.details;
  switch (entry.kind) {
    case 'COMMAND':
      return `${String(d.state ?? '')} ${d.resultStatus ? `· ${String(d.resultStatus)}` : ''} · ${String(d.requestedBy ?? '')}`;
    case 'ALARM':
      return `${String(d.severity ?? '')} · ${String(d.status ?? '')} ×${String(d.occurrences ?? 1)}`;
    case 'LIFECYCLE':
      return `${d.from ? `${String(d.from)} → ` : ''}${entry.title} · ${String(d.actor ?? '')}`;
    case 'SESSION':
      return `${String(d.sessionNo ?? '')} · ${String(d.channel ?? '')}${d.energyWh != null ? ` · ${Number(d.energyWh) / 1000} kWh` : ''}`;
    case 'CONNECTION':
      return `${String(d.pod ?? '')} · gen ${String(d.generation ?? '')}${d.closeCode ? ` · ${String(d.closeCode)}` : ''}`;
    default:
      return `${String(d.direction ?? '')} ${d.errorCode ? `· ${String(d.errorCode)}` : ''}`;
  }
}
