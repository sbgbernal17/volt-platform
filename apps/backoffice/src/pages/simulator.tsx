import { type FormEvent, useState } from 'react';
import { useApi } from '../auth/auth.tsx';
import { DataTable } from '../components/data-table.tsx';
import { Alert, ErrorBox, Field, JsonView, PageHeader } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { money } from '../lib/format.ts';
import type { Items } from '../lib/types.ts';
import { useMutation, useQuery } from '../lib/use-query.ts';

interface TariffOption {
  id: string;
  code: string;
  active_version: number | null;
  currency: string;
}
interface TariffDetail {
  versions: { id: string; version: number; status: string }[];
}
interface SimResult {
  currency: string;
  lines: {
    seq: number;
    dimension: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    total: string;
    periodStart: string | null;
  }[];
  total: string;
  totalMinor: string;
  subtotal: string;
  tax: string;
  capped: boolean;
  flags: string[];
  summary: Record<string, unknown>;
}

function localDefault(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d.toISOString().slice(0, 16);
}

export function SimulatorPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const tariffs = useQuery(() => api.get<Items<TariffOption>>('/tariffs'), []);
  const [tariffId, setTariffId] = useState('');
  const versions = useQuery(
    () =>
      tariffId ? api.get<TariffDetail>(`/tariffs/${tariffId}`) : Promise.resolve({ versions: [] }),
    [tariffId],
  );
  const [versionId, setVersionId] = useState('');
  const [scenario, setScenario] = useState({
    startAt: localDefault(),
    durationMin: '60',
    energyWh: '40000',
    idleMin: '0',
    powerW: '60000',
  });
  const [result, setResult] = useState<SimResult | null>(null);
  const mutation = useMutation();

  const run = (event: FormEvent) => {
    event.preventDefault();
    const list = versions.data?.versions ?? [];
    const version =
      versionId ||
      (
        list.find((v) => v.status === 'ACTIVE') ??
        list.find((v) => v.status === 'SCHEDULED') ??
        list.at(-1)
      )?.id;
    if (!version) return;
    void mutation
      .run(() =>
        api.post<SimResult>('/pricing/simulate', {
          tariffVersionId: version,
          timezone: 'America/Bogota',
          mode: 'FINAL',
          scenario: {
            startAt: new Date(scenario.startAt).toISOString(),
            durationMin: Number(scenario.durationMin),
            energyWh: Number(scenario.energyWh),
            idleMin: Number(scenario.idleMin) || undefined,
            powerW: Number(scenario.powerW) || undefined,
          },
        }),
      )
      .then((r) => {
        if (r) setResult(r);
      });
  };

  return (
    <>
      <PageHeader title={t('sim.title')} />
      <form className="card" onSubmit={run}>
        <p className="help">{t('sim.intro')}</p>
        <ErrorBox error={mutation.error} />
        <div className="grid cols-3">
          <Field label={t('tariffs.title')}>
            <select
              value={tariffId}
              onChange={(e) => {
                setTariffId(e.target.value);
                setVersionId('');
              }}
              required
            >
              <option value="">—</option>
              {tariffs.data?.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('sim.tariffVersion')}>
            <select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              <option value="">{t('tariffs.published')}</option>
              {versions.data?.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version} · {v.status}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('sim.startAt')}>
            <input
              type="datetime-local"
              value={scenario.startAt}
              onChange={(e) => setScenario({ ...scenario, startAt: e.target.value })}
              required
            />
          </Field>
          <Field label={t('sim.durationMin')}>
            <input
              type="number"
              min={1}
              max={1440}
              value={scenario.durationMin}
              onChange={(e) => setScenario({ ...scenario, durationMin: e.target.value })}
              required
            />
          </Field>
          <Field label={t('sim.energyWh')}>
            <input
              type="number"
              min={0}
              value={scenario.energyWh}
              onChange={(e) => setScenario({ ...scenario, energyWh: e.target.value })}
              required
            />
          </Field>
          <Field label={t('sim.idleMin')}>
            <input
              type="number"
              min={0}
              max={1440}
              value={scenario.idleMin}
              onChange={(e) => setScenario({ ...scenario, idleMin: e.target.value })}
            />
          </Field>
          <Field label={t('sim.powerW')}>
            <input
              type="number"
              min={0}
              value={scenario.powerW}
              onChange={(e) => setScenario({ ...scenario, powerW: e.target.value })}
            />
          </Field>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary" disabled={mutation.busy || !tariffId}>
            {t('sim.run')}
          </button>
        </div>
      </form>
      {result ? (
        <div className="card">
          <h2>
            {t('sim.result')}: {money(result.totalMinor, result.currency, locale)}
          </h2>
          {result.capped ? <Alert tone="warning">{t('sessions.exposure')}</Alert> : null}
          <DataTable
            rows={result.lines}
            rowKey={(l) => String(l.seq)}
            columns={[
              { key: 'dim', header: t('sessions.line.dimension'), render: (l) => l.dimension },
              {
                key: 'qty',
                header: t('sessions.line.quantity'),
                render: (l) => `${l.quantity} ${l.unit}`,
                align: 'right',
              },
              {
                key: 'price',
                header: t('sessions.line.unitPrice'),
                render: (l) => l.unitPrice,
                align: 'right',
              },
              {
                key: 'total',
                header: t('sessions.line.amount'),
                render: (l) => l.total,
                align: 'right',
              },
            ]}
          />
          <p className="muted small mt">
            {t('sessions.subtotal')} {result.subtotal} · {t('sessions.tax')} {result.tax}
            {result.flags.length ? ` · ${result.flags.join(', ')}` : ''}
          </p>
          <details>
            <summary className="small muted">{t('app.details')}</summary>
            <JsonView value={result.summary} />
          </details>
        </div>
      ) : null}
    </>
  );
}
