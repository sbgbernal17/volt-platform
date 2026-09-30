import type { ReactNode } from 'react';
import { useState } from 'react';
import { useI18n } from '../i18n/index.tsx';
import type { ApiError } from '../lib/api.ts';
import {
  billingVisual,
  connectorVisual,
  lifecycleVisual,
  paymentVisual,
  type StatusVisual,
  sessionVisual,
  severityVisual,
  type Tone,
} from '../lib/status.ts';
import { errorMessage } from '../lib/use-query.ts';
import { Icon } from './icon.tsx';

export type { Tone };

export function Badge({
  tone = 'neutral',
  icon,
  outlined = false,
  dotted = false,
  children,
}: {
  tone?: Tone | undefined;
  icon?: string | undefined;
  outlined?: boolean | undefined;
  dotted?: boolean | undefined;
  children: ReactNode;
}) {
  const classes = [
    'badge',
    tone === 'neutral' ? '' : tone,
    outlined ? 'outlined' : '',
    dotted ? 'dotted' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </span>
  );
}

/** Insignia a partir de un estado del dominio: palabra traducida, ícono y color (lib/status.ts). */
export function VisualBadge({ visual }: { visual: StatusVisual }) {
  const { td } = useI18n();
  return (
    <Badge tone={visual.tone} icon={visual.icon} outlined={visual.outlined} dotted={visual.dotted}>
      {td(visual.label)}
    </Badge>
  );
}

export function connectorTone(status: string, connected = true): Tone {
  return connectorVisual(status, connected).tone;
}

export function StatusBadge({
  status,
  connected = true,
}: {
  status: string;
  connected?: boolean | undefined;
}) {
  return <VisualBadge visual={connectorVisual(status, connected)} />;
}

export function LifecycleBadge({ value }: { value: string }) {
  return <VisualBadge visual={lifecycleVisual(value)} />;
}

export function SessionBadge({ value }: { value: string }) {
  return <VisualBadge visual={sessionVisual(value)} />;
}

export function SeverityBadge({ value }: { value: string }) {
  return <VisualBadge visual={severityVisual(value)} />;
}

export function PaymentBadge({ value }: { value: string | null | undefined }) {
  return <VisualBadge visual={paymentVisual(value)} />;
}

export function BillingBadge({ value }: { value: string }) {
  return <VisualBadge visual={billingVisual(value)} />;
}

const ALERT_ICONS: Record<'error' | 'ok' | 'warning' | 'info', string> = {
  error: 'error',
  ok: 'check-circle',
  warning: 'warning',
  info: 'info',
};

export function Alert({
  tone,
  icon,
  children,
  action,
}: {
  tone: 'error' | 'ok' | 'warning' | 'info';
  icon?: string | undefined;
  children: ReactNode;
  action?: ReactNode | undefined;
}) {
  return (
    <div className={`alert ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={icon ?? ALERT_ICONS[tone]} />
      <div className="body">
        {children}
        {action ? <div className="mt">{action}</div> : null}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: ApiError | Error | null }) {
  const message = errorMessage(error);
  return message ? <Alert tone="error">{message}</Alert> : null;
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{t('app.loading')}</span>
    </div>
  );
}

export function Empty({
  icon = 'inbox',
  text,
}: {
  icon?: string | undefined;
  text?: string | undefined;
}) {
  const { t } = useI18n();
  return (
    <div className="empty">
      <span className="circle">
        <Icon name={icon} />
      </span>
      <span>{text ?? t('app.none')}</span>
    </div>
  );
}

export function Kpi({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: ReactNode;
  unit?: string | undefined;
  sub?: ReactNode | undefined;
}) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
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

/** Selector segmentado (dos o tres opciones excluyentes), como los chips de la app. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; icon?: string | undefined }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" title={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={option.id === value ? 'active' : ''}
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.icon ? <Icon name={option.icon} size="sm" /> : null}
          {option.label}
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
        <Icon name={copied ? 'check' : 'content-copy'} size="sm" />
        {copied ? t('app.copied') : t('app.copy')}
      </button>
    </span>
  );
}

/** Cabecera de página: flecha de volver (como la barra superior de la app), título, subtítulo y acciones. */
export function PageHeader({
  title,
  subtitle,
  onBack,
  actions,
}: {
  title: string;
  subtitle?: ReactNode | undefined;
  onBack?: (() => void) | undefined;
  actions?: ReactNode | undefined;
}) {
  const { t } = useI18n();
  return (
    <div className="topbar">
      <div className="heading">
        {onBack ? (
          <button type="button" className="icon-button" onClick={onBack} aria-label={t('app.back')}>
            <Icon name="arrow-back" />
          </button>
        ) : null}
        <div>
          <h1>{title}</h1>
          {subtitle ? <p className="subtitle">{subtitle}</p> : null}
        </div>
      </div>
      <div className="right">{actions}</div>
    </div>
  );
}
