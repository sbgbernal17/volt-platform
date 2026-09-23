import type { ReactNode } from 'react';
import { useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import type { ApiError } from '../lib/api.ts';
import { errorMessage } from '../lib/use-query.ts';

type Tone = 'ok' | 'info' | 'warning' | 'danger' | 'primary' | 'neutral';

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: Tone | undefined;
  children: ReactNode;
}) {
  return <span className={`badge ${tone === 'neutral' ? '' : tone}`}>{children}</span>;
}

const CONNECTOR_TONES: Record<string, Tone> = {
  Available: 'ok',
  Preparing: 'info',
  Charging: 'primary',
  SuspendedEV: 'info',
  SuspendedEVSE: 'warning',
  Finishing: 'info',
  Reserved: 'info',
  Unavailable: 'neutral',
  Faulted: 'danger',
  Offline: 'neutral',
};

export function connectorTone(status: string, connected = true): Tone {
  if (!connected) return 'neutral';
  return CONNECTOR_TONES[status] ?? 'neutral';
}

export function StatusBadge({
  status,
  connected = true,
}: {
  status: string;
  connected?: boolean | undefined;
}) {
  const { td } = useI18n();
  const shown = connected ? status : 'Offline';
  return <Badge tone={connectorTone(shown, connected)}>{td(`status.${shown}`)}</Badge>;
}

const LIFECYCLE_TONES: Record<string, Tone> = {
  INVENTORIED: 'neutral',
  PROVISIONED: 'info',
  CONNECTED_PENDING: 'warning',
  CONFIGURED: 'info',
  TESTED: 'primary',
  OPERATIONAL: 'ok',
  MAINTENANCE: 'warning',
  REJECTED: 'danger',
  DECOMMISSIONED: 'neutral',
};

export function LifecycleBadge({ value }: { value: string }) {
  const { td } = useI18n();
  return <Badge tone={LIFECYCLE_TONES[value] ?? 'neutral'}>{td(`lifecycle.${value}`)}</Badge>;
}

const SESSION_TONES: Record<string, Tone> = {
  CHARGING: 'primary',
  SUSPENDED: 'info',
  STARTING: 'info',
  AUTHORIZING: 'info',
  STOPPING: 'warning',
  ENDED: 'neutral',
  SETTLED: 'ok',
  PAID: 'ok',
  FAILED: 'danger',
  EXPIRED: 'warning',
  CANCELLED: 'neutral',
};

export function SessionBadge({ value }: { value: string }) {
  return <Badge tone={SESSION_TONES[value] ?? 'neutral'}>{value}</Badge>;
}

export function SeverityBadge({ value }: { value: string }) {
  const tone: Tone = value === 'CRITICAL' ? 'danger' : value === 'WARNING' ? 'warning' : 'info';
  return <Badge tone={tone}>{value}</Badge>;
}

export function PaymentBadge({ value }: { value: string | null | undefined }) {
  const tones: Record<string, Tone> = {
    PAID: 'ok',
    CAPTURED: 'ok',
    APPROVED: 'ok',
    PENDING: 'info',
    FAILED: 'danger',
    DECLINED: 'danger',
    ERROR: 'danger',
    REFUNDED: 'warning',
    VOIDED: 'warning',
    NONE: 'neutral',
    OPEN: 'warning',
    WAIVED: 'neutral',
  };
  const shown = value ?? '—';
  return <Badge tone={tones[shown] ?? 'neutral'}>{shown}</Badge>;
}

export function Alert({
  tone,
  children,
}: {
  tone: 'error' | 'ok' | 'warning' | 'info';
  children: ReactNode;
}) {
  return <div className={`alert ${tone}`}>{children}</div>;
}

export function ErrorBox({ error }: { error: ApiError | Error | null }) {
  const message = errorMessage(error);
  return message ? <Alert tone="error">{message}</Alert> : null;
}

export function Loading() {
  const { t } = useI18n();
  return <p className="muted">{t('app.loading')}</p>;
}

export function Empty() {
  const { t } = useI18n();
  return <p className="muted">{t('app.none')}</p>;
}

export function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode | undefined;
}) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={tab.id === active ? 'active' : ''}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function JsonView({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

export function Field({
  label,
  children,
  help,
}: {
  label: string;
  children: ReactNode;
  help?: string | undefined;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: el control llega como children dentro del label
    <label className="field">
      <span>{label}</span>
      {children}
      {help ? <div className="help">{help}</div> : null}
    </label>
  );
}

export function Copyable({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <span className="row">
      <code>{value}</code>
      <button
        type="button"
        className="small"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? t('app.copied') : t('app.copy')}
      </button>
    </span>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode | undefined }) {
  return (
    <div className="topbar">
      <h1>{title}</h1>
      <div className="right">{actions}</div>
    </div>
  );
}
