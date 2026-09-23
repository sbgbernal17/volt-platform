import { type ReactNode, useEffect, useState } from 'react';
import { useI18n } from '../i18n/index.tsx';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: ReactNode | undefined;
  /** Pide un motivo obligatorio (queda en la auditoría). */
  requireReason?: boolean | undefined;
  danger?: boolean | undefined;
  confirmLabel?: string | undefined;
  busy?: boolean | undefined;
  onConfirm: (reason: string) => void | Promise<void>;
  onCancel: () => void;
  children?: ReactNode | undefined;
}

/** Confirmación en dos pasos para acciones sensibles (OPS §4: comandos, cambios de tarifa, devoluciones). */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (props.open) setReason('');
  }, [props.open]);
  if (!props.open) return null;
  const disabled = props.busy || (props.requireReason && reason.trim().length < 3);
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onKeyDown={(event) => {
          if (event.key === 'Escape') props.onCancel();
        }}
      >
        <h2>{props.title}</h2>
        {props.message ? <p>{props.message}</p> : null}
        {props.children}
        {props.requireReason ? (
          <label className="field">
            <span>{t('app.reason')}</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
            />
            <div className="help">{t('app.reasonHelp')}</div>
          </label>
        ) : null}
        <div className="form-actions">
          <button type="button" onClick={props.onCancel} disabled={props.busy}>
            {t('app.cancel')}
          </button>
          <button
            type="button"
            className={props.danger ? 'danger' : 'primary'}
            disabled={disabled}
            onClick={() => void props.onConfirm(reason.trim())}
          >
            {props.confirmLabel ?? t('app.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
