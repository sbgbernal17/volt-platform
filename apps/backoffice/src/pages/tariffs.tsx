/**
 * Tarifas (iteración 4, rediseño en la 9): guía de pasos, editor guiado de versiones que genera la
 * definición OCPI (con modo JSON para reglas avanzadas), vista previa con simulación, resumen en
 * frases de cada versión y asignaciones con selectores de sede, cargador y conector.
 */
import { type FormEvent, useMemo, useState } from 'react';
import { useApi, useAuth } from '../auth/auth.tsx';
import { ConfirmDialog } from '../components/confirm-dialog.tsx';
import { DataTable } from '../components/data-table.tsx';
import { Alert, Badge, ErrorBox, Field, JsonView, Loading, PageHeader } from '../components/ui.tsx';
import { type MessageKey, useI18n } from '../i18n/index.tsx';
import { connectorStandard, dateTime, money, moneyMajor } from '../lib/format.ts';
import { useRouter } from '../lib/router.tsx';
import {
  type DayPreset,
  definitionToForm,
  describeTariff,
  emptyForm,
  formToDefinition,
  type IdleStart,
  type TariffForm,
  TariffFormError,
} from '../lib/tariff-form.ts';
import type { ChargePointListItem, Items, Site } from '../lib/types.ts';
import { errorMessage, useMutation, useQuery } from '../lib/use-query.ts';

interface Tariff {
  id: string;
  code: string;
  name: string;
  currency: string;
  created_by: string;
  created_at: string;
  versions: number;
  active_version: number | null;
}

interface TariffVersion {
  id: string;
  version: number;
  status: string;
  valid_from: string | null;
  valid_to: string | null;
  tax_included: boolean;
  definition: unknown;
  notes: string | null;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  published_at: string | null;
}

interface Assignment {
  id: string;
  scope_type: string;
  scope_id: string;
  segment: string;
  tariff_id: string;
  priority: number;
  valid_from: string;
  valid_to: string | null;
  created_by: string;
}

interface TariffDetail extends Omit<Tariff, 'versions' | 'active_version'> {
  versions: TariffVersion[];
  assignments: Assignment[];
}

interface SimulationResult {
  currency: string;
  lines: { seq: number; dimension: string; quantity: string; unit: string; total: string }[];
  total: string;
  totalMinor: string;
  capped: boolean;
}

const SCOPE_TYPES = [
  'PLATFORM',
  'TENANT',
  'SITE',
  'CHARGE_POINT',
  'CONNECTOR',
  'CONNECTOR_TYPE',
] as const;
const SEGMENTS = ['PUBLIC', 'INTERNAL', 'EMPLOYEE', 'ADHOC'] as const;
const CONNECTOR_STANDARDS = [
  'IEC_62196_T2_COMBO',
  'IEC_62196_T1_COMBO',
  'GBT_DC',
  'CHADEMO',
  'IEC_62196_T2',
  'IEC_62196_T1',
  'GBT_AC',
] as const;
const DAY_PRESET_OPTIONS: DayPreset[] = ['ALL', 'WEEKDAYS', 'WEEKEND'];
const IDLE_STARTS: IdleStart[] = ['EARLIEST', 'TRANSACTION_END', 'SUSPENDED_EV'];

/** Cantidad de una línea del ejemplo en formato local: `30 kWh`, `5 min`, `1 sesión`. */
function quantity(line: { quantity: string; unit: string }, locale: 'es' | 'en'): string {
  const value = Number(line.quantity);
  if (!Number.isFinite(value)) return `${line.quantity} ${line.unit}`;
  const text = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-CO', {
    maximumFractionDigits: 2,
  }).format(value);
  return `${text} ${line.unit}`;
}

function versionTone(status: string): 'ok' | 'info' | 'neutral' {
  if (status === 'ACTIVE') return 'ok';
  if (status === 'DRAFT' || status === 'SCHEDULED') return 'info';
  return 'neutral';
}

function localDateTime(offsetHours = 0): string {
  const date = new Date(Date.now() + offsetHours * 3_600_000);
  date.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Nombres legibles de los alcances de asignación a partir del inventario cargado. */
function useScopeLabels() {
  const api = useApi();
  const { t, locale } = useI18n();
  const sites = useQuery(() => api.get<Items<Site>>('/sites'), []);
  const chargePoints = useQuery(() => api.get<Items<ChargePointListItem>>('/charge-points'), []);
  const connectors = useMemo(
    () =>
      (chargePoints.data?.items ?? []).flatMap((cp) =>
        cp.connectors.map((c) => ({
          id: c.id,
          label: `${c.evse_code} · ${connectorStandard(c.standard, locale)}`,
          chargeBoxId: cp.charge_box_id,
        })),
      ),
    [chargePoints.data, locale],
  );
  const scopeLabel = (assignment: Pick<Assignment, 'scope_type' | 'scope_id'>): string => {
    const kind = t(`tariffs.scope.${assignment.scope_type}` as MessageKey);
    switch (assignment.scope_type) {
      case 'PLATFORM':
      case 'TENANT':
        return kind;
      case 'SITE': {
        const site = sites.data?.items.find((s) => s.id === assignment.scope_id);
        return `${kind}: ${site ? `${site.code} · ${site.name}` : assignment.scope_id.slice(0, 8)}`;
      }
      case 'CHARGE_POINT': {
        const cp = chargePoints.data?.items.find((c) => c.id === assignment.scope_id);
        return `${kind}: ${cp?.charge_box_id ?? assignment.scope_id.slice(0, 8)}`;
      }
      case 'CONNECTOR': {
        const connector = connectors.find((c) => c.id === assignment.scope_id);
        return `${kind}: ${connector?.label ?? assignment.scope_id.slice(0, 8)}`;
      }
      case 'CONNECTOR_TYPE':
        return `${kind}: ${connectorStandard(assignment.scope_id, locale)}`;
      default:
        return `${assignment.scope_type} · ${assignment.scope_id.slice(0, 8)}`;
    }
  };
  return { sites, chargePoints, connectors, scopeLabel };
}

function GuideCard({ open }: { open: boolean }) {
  const { t } = useI18n();
  return (
    <details className="card guide" open={open}>
      <summary>
        <strong>{t('tariffs.guideTitle')}</strong>
      </summary>
      <ol className="steps">
        <li>{t('tariffs.guide1')}</li>
        <li>{t('tariffs.guide2')}</li>
        <li>{t('tariffs.guide3')}</li>
        <li>{t('tariffs.guide4')}</li>
      </ol>
    </details>
  );
}

function AssignmentsTable({
  rows,
  tariffCode,
  scopeLabel,
  onEnd,
}: {
  rows: Assignment[];
  tariffCode: (id: string) => string;
  scopeLabel: (a: Assignment) => string;
  onEnd?: ((a: Assignment) => void) | undefined;
}) {
  const { t, locale } = useI18n();
  return (
    <DataTable
      rows={rows}
      rowKey={(a) => a.id}
      columns={[
        { key: 'scope', header: t('tariffs.scope'), render: (a) => scopeLabel(a) },
        { key: 'segment', header: t('tariffs.segment'), render: (a) => a.segment },
        {
          key: 'tariff',
          header: t('tariffs.title'),
          render: (a) => <strong>{tariffCode(a.tariff_id)}</strong>,
        },
        { key: 'prio', header: t('tariffs.priority'), render: (a) => a.priority, align: 'right' },
        {
          key: 'from',
          header: t('tariffs.validFrom'),
          render: (a) => dateTime(a.valid_from, locale),
        },
        {
          key: 'to',
          header: t('tariffs.validTo'),
          render: (a) => (a.valid_to ? dateTime(a.valid_to, locale) : t('tariffs.open')),
        },
        {
          key: 'act',
          header: '',
          render: (a) =>
            onEnd && !a.valid_to ? (
              <button type="button" className="small" onClick={() => onEnd(a)}>
                {t('tariffs.end')}
              </button>
            ) : null,
        },
      ]}
    />
  );
}

export function TariffsPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const tariffs = useQuery(() => api.get<Items<Tariff>>('/tariffs'), []);
  const assignments = useQuery(() => api.get<Items<Assignment>>('/tariff-assignments'), []);
  const audit = useQuery(
    () =>
      api.get<
        Items<{
          id: string;
          at: string;
          actor: string;
          entity: string;
          entity_id: string;
          action: string;
          details: unknown;
        }>
      >('/pricing/audit', { limit: 30 }),
    [],
  );
  const { sites, chargePoints, connectors, scopeLabel } = useScopeLabels();
  const mutation = useMutation();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', currency: 'COP' });
  const [assigning, setAssigning] = useState(false);
  const [assignment, setAssignment] = useState({
    scopeType: 'PLATFORM',
    scopeId: '',
    segment: 'PUBLIC',
    customSegment: '',
    tariffId: '',
    priority: '0',
    validFrom: '',
  });
  const [confirm, setConfirm] = useState<{ title: string; action: () => Promise<unknown> } | null>(
    null,
  );

  const create = (event: FormEvent) => {
    event.preventDefault();
    void mutation
      .run(() => api.post<Tariff>('/tariffs', form))
      .then((created) => {
        if (created) navigate(`/tariffs/${created.id}`);
      });
  };
  const segmentValue =
    assignment.segment === 'custom' ? assignment.customSegment.toUpperCase() : assignment.segment;
  const needsTarget = !['PLATFORM', 'TENANT'].includes(assignment.scopeType);
  const assign = (event: FormEvent) => {
    event.preventDefault();
    void mutation
      .run(
        () =>
          api.post('/tariff-assignments', {
            scopeType: assignment.scopeType,
            scopeId: needsTarget ? assignment.scopeId : undefined,
            segment: segmentValue,
            tariffId: assignment.tariffId,
            priority: Number(assignment.priority) || 0,
            validFrom: assignment.validFrom
              ? new Date(assignment.validFrom).toISOString()
              : undefined,
          }),
        t('tariffs.assigned'),
      )
      .then((created) => {
        if (created) {
          setAssigning(false);
          void assignments.reload();
        }
      });
  };
  const tariffCode = (id: string) =>
    tariffs.data?.items.find((x) => x.id === id)?.code ?? id.slice(0, 8);
  const noTariffs = tariffs.data !== undefined && tariffs.data.items.length === 0;

  return (
    <>
      <PageHeader
        title={t('tariffs.title')}
        actions={
          <>
            {auth.can('pricing:write') ? (
              <button
                type="button"
                title={t('tariffs.bootstrapHelp')}
                onClick={() =>
                  setConfirm({
                    title: t('tariffs.bootstrap'),
                    action: () => api.post('/tariffs/bootstrap'),
                  })
                }
              >
                {t('tariffs.bootstrap')}
              </button>
            ) : null}
            {auth.can('pricing:publish') ? (
              <button type="button" onClick={() => setAssigning((v) => !v)}>
                {t('tariffs.assign')}
              </button>
            ) : null}
            {auth.can('pricing:write') ? (
              <button type="button" className="primary" onClick={() => setCreating((v) => !v)}>
                {t('tariffs.new')}
              </button>
            ) : null}
          </>
        }
      />
      <GuideCard open={noTariffs} />
      <ErrorBox error={mutation.error} />
      {mutation.message ? <Alert tone="ok">{mutation.message}</Alert> : null}
      {creating ? (
        <form className="card" onSubmit={create}>
          <h2>{t('tariffs.new')}</h2>
          <div className="grid cols-3">
            <Field label={t('tariffs.code')} help={t('tariffs.codeHelp')}>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                required
                minLength={2}
                maxLength={36}
                placeholder="VOLT-BASE"
              />
            </Field>
            <Field label={t('tariffs.name')} help={t('tariffs.nameHelp')}>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                maxLength={120}
                placeholder="Tarifa VOLT"
              />
            </Field>
            <Field label={t('tariffs.currency')}>
              <input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                pattern="[A-Z]{3}"
                required
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
      {assigning ? (
        <form className="card" onSubmit={assign}>
          <h2>{t('tariffs.assign')}</h2>
          <p className="help">{t('tariffs.scopeHelp')}</p>
          <div className="grid cols-3">
            <Field label={t('tariffs.title')}>
              <select
                value={assignment.tariffId}
                onChange={(e) => setAssignment({ ...assignment, tariffId: e.target.value })}
                required
              >
                <option value="">—</option>
                {tariffs.data?.items.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} · {x.name}
                    {x.active_version ? '' : ` (${t('tariffs.noActiveShort')})`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('tariffs.scope')}>
              <select
                value={assignment.scopeType}
                onChange={(e) =>
                  setAssignment({ ...assignment, scopeType: e.target.value, scopeId: '' })
                }
              >
                {SCOPE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {t(`tariffs.scope.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            {needsTarget ? (
              <Field label={t('tariffs.scopeTarget')}>
                <select
                  value={assignment.scopeId}
                  onChange={(e) => setAssignment({ ...assignment, scopeId: e.target.value })}
                  required
                >
                  <option value="">—</option>
                  {assignment.scopeType === 'SITE'
                    ? sites.data?.items.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} · {s.name}
                        </option>
                      ))
                    : null}
                  {assignment.scopeType === 'CHARGE_POINT'
                    ? chargePoints.data?.items.map((cp) => (
                        <option key={cp.id} value={cp.id}>
                          {cp.charge_box_id}
                        </option>
                      ))
                    : null}
                  {assignment.scopeType === 'CONNECTOR'
                    ? connectors.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))
                    : null}
                  {assignment.scopeType === 'CONNECTOR_TYPE'
                    ? CONNECTOR_STANDARDS.map((s) => (
                        <option key={s} value={s}>
                          {connectorStandard(s, locale)} ({s})
                        </option>
                      ))
                    : null}
                </select>
              </Field>
            ) : null}
            <Field label={t('tariffs.segment')} help={t('tariffs.segmentHelp')}>
              <select
                value={assignment.segment}
                onChange={(e) => setAssignment({ ...assignment, segment: e.target.value })}
              >
                {SEGMENTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`tariffs.segmentName.${s}`)}
                  </option>
                ))}
                <option value="custom">{t('tariffs.segment.custom')}</option>
              </select>
            </Field>
            {assignment.segment === 'custom' ? (
              <Field label={t('tariffs.segment.custom')}>
                <input
                  value={assignment.customSegment}
                  onChange={(e) => setAssignment({ ...assignment, customSegment: e.target.value })}
                  placeholder="FLEET:TAXIS"
                  pattern="(MEMBER|FLEET|ROAMING):[A-Za-z0-9_-]{1,64}"
                  required
                />
              </Field>
            ) : null}
            <Field label={t('tariffs.priority')} help={t('tariffs.priorityHelp')}>
              <input
                type="number"
                min={-1000}
                max={1000}
                value={assignment.priority}
                onChange={(e) => setAssignment({ ...assignment, priority: e.target.value })}
              />
            </Field>
            <Field label={t('tariffs.assignFrom')}>
              <input
                type="datetime-local"
                value={assignment.validFrom}
                onChange={(e) => setAssignment({ ...assignment, validFrom: e.target.value })}
              />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" onClick={() => setAssigning(false)}>
              {t('app.cancel')}
            </button>
            <button type="submit" className="primary" disabled={mutation.busy}>
              {t('app.save')}
            </button>
          </div>
        </form>
      ) : null}
      <div className="card">
        <h2>{t('tariffs.title')}</h2>
        <ErrorBox error={tariffs.error} />
        {tariffs.loading ? <Loading /> : null}
        {noTariffs ? <p className="muted">{t('tariffs.noTariffs')}</p> : null}
        {!noTariffs ? (
          <DataTable
            rows={tariffs.data?.items ?? []}
            rowKey={(x) => x.id}
            onRowClick={(x) => navigate(`/tariffs/${x.id}`)}
            columns={[
              { key: 'code', header: t('tariffs.code'), render: (x) => <strong>{x.code}</strong> },
              { key: 'name', header: t('tariffs.name'), render: (x) => x.name },
              { key: 'cur', header: t('tariffs.currency'), render: (x) => x.currency },
              {
                key: 'versions',
                header: t('tariffs.versions'),
                render: (x) => x.versions,
                align: 'right',
              },
              {
                key: 'active',
                header: t('tariffs.published'),
                render: (x) =>
                  x.active_version ? (
                    <Badge tone="ok">v{x.active_version}</Badge>
                  ) : (
                    <Badge tone="warning">{t('tariffs.noActiveShort')}</Badge>
                  ),
              },
              {
                key: 'assign',
                header: t('tariffs.assignments'),
                render: (x) =>
                  (assignments.data?.items ?? []).filter((a) => a.tariff_id === x.id && !a.valid_to)
                    .length,
                align: 'right',
              },
              {
                key: 'created',
                header: t('app.created'),
                render: (x) => dateTime(x.created_at, locale),
              },
            ]}
          />
        ) : null}
      </div>
      <div className="card">
        <h2>{t('tariffs.assignments')}</h2>
        <p className="help">{t('tariffs.assignmentsHelp')}</p>
        <AssignmentsTable
          rows={assignments.data?.items ?? []}
          tariffCode={tariffCode}
          scopeLabel={scopeLabel}
          onEnd={
            auth.can('pricing:publish')
              ? (a) =>
                  setConfirm({
                    title: `${t('tariffs.end')} ${tariffCode(a.tariff_id)} · ${scopeLabel(a)}`,
                    action: () => api.post(`/tariff-assignments/${a.id}/end`),
                  })
              : undefined
          }
        />
      </div>
      <div className="card">
        <h2>{t('tariffs.audit')}</h2>
        <DataTable
          rows={audit.data?.items ?? []}
          rowKey={(a) => String(a.id)}
          columns={[
            { key: 'at', header: t('audit.when'), render: (a) => dateTime(a.at, locale) },
            { key: 'actor', header: t('audit.actor'), render: (a) => <code>{a.actor}</code> },
            { key: 'action', header: t('audit.action'), render: (a) => a.action },
            {
              key: 'entity',
              header: t('audit.entity'),
              render: (a) => `${a.entity} ${a.entity_id.slice(0, 8)}`,
            },
          ]}
        />
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        busy={mutation.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const action = confirm?.action;
          setConfirm(null);
          if (action) {
            await mutation.run(action);
            void tariffs.reload();
            void assignments.reload();
          }
        }}
      />
    </>
  );
}

/** Editor de una versión: formulario guiado o JSON, con validación y ejemplo simulado. */
function VersionEditor({
  tariff,
  latest,
  onSaved,
  onCancel,
}: {
  tariff: TariffDetail;
  latest: TariffVersion | undefined;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t, td, locale } = useI18n();
  const api = useApi();
  const mutation = useMutation();
  const initialForm = useMemo(
    () => (latest ? definitionToForm(latest.definition) : emptyForm()),
    [latest],
  );
  const [mode, setMode] = useState<'form' | 'json'>(initialForm ? 'form' : 'json');
  const [form, setForm] = useState<TariffForm>(initialForm ?? emptyForm());
  const [json, setJson] = useState(() =>
    JSON.stringify(
      latest?.definition ?? {
        country_code: 'CO',
        party_id: 'VLT',
        id: tariff.code,
        currency: tariff.currency,
        elements: [],
      },
      null,
      2,
    ),
  );
  const [taxIncluded, setTaxIncluded] = useState(latest?.tax_included ?? false);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [validation, setValidation] = useState<{
    ok: boolean;
    message: string;
    warnings: string[];
  } | null>(null);
  const [example, setExample] = useState<SimulationResult | null>(null);

  const definition = useMemo(() => {
    if (mode === 'json') {
      try {
        return { value: JSON.parse(json) as unknown, error: null };
      } catch {
        return { value: null, error: t('tariffs.jsonInvalid') };
      }
    }
    try {
      return {
        value: formToDefinition(form, {
          code: tariff.code,
          currency: tariff.currency,
          existing: latest?.definition,
        }) as unknown,
        error: null,
      };
    } catch (error) {
      if (error instanceof TariffFormError)
        return { value: null, error: t('tariffs.editor.invalidNumber') };
      return { value: null, error: (error as Error).message };
    }
  }, [mode, json, form, tariff.code, tariff.currency, latest?.definition, t]);
  const summary = useMemo(
    () => (definition.value ? describeTariff(definition.value, locale) : []),
    [definition.value, locale],
  );
  // Desde el JSON solo se vuelve al formulario si este puede representarlo.
  const jsonAsForm = useMemo(
    () => (mode === 'json' ? definitionToForm(definition.value) : null),
    [mode, definition.value],
  );

  const update = <K extends keyof TariffForm>(key: K, value: TariffForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setValidation(null);
    setExample(null);
  };
  const updateBand = (index: number, patch: Partial<TariffForm['bands'][number]>) =>
    update(
      'bands',
      form.bands.map((band, i) => (i === index ? { ...band, ...patch } : band)),
    );

  const validate = async () => {
    if (!definition.value) {
      setFormError(definition.error);
      return;
    }
    setFormError(null);
    try {
      const result = await api.post<{ warnings: string[] }>(
        `/tariffs/${tariff.id}/versions/validate`,
        { definition: definition.value },
      );
      setValidation({
        ok: true,
        message: t('tariffs.editor.validated'),
        warnings: result.warnings,
      });
      const start = new Date();
      start.setHours(10, 0, 0, 0);
      const simulated = await api.post<SimulationResult>('/pricing/simulate', {
        tariff: definition.value,
        timezone: 'America/Bogota',
        mode: 'FINAL',
        taxIncluded,
        scenario: {
          startAt: start.toISOString(),
          durationMin: 45,
          energyWh: 30_000,
          idleMin: 20,
          powerW: 50_000,
        },
      });
      setExample(simulated);
    } catch (error) {
      setValidation({
        ok: false,
        message: errorMessage(error as Error) ?? t('app.error'),
        warnings: [],
      });
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!definition.value) {
      setFormError(definition.error);
      return;
    }
    setFormError(null);
    void mutation
      .run(() =>
        api.post(`/tariffs/${tariff.id}/versions`, {
          definition: definition.value,
          taxIncluded,
          notes: notes || undefined,
        }),
      )
      .then((saved) => {
        if (saved) onSaved();
      });
  };

  const priceLabel = `${tariff.currency}`;

  return (
    <form className="card editor" onSubmit={save}>
      <div className="row between mb">
        <h2>{t('tariffs.newVersion')}</h2>
        <div className="tabs compact">
          <button
            type="button"
            className={mode === 'form' ? 'active' : ''}
            onClick={() => {
              if (mode === 'json' && jsonAsForm) setForm(jsonAsForm);
              setMode('form');
            }}
            disabled={mode === 'json' && !jsonAsForm}
          >
            {t('tariffs.editor.mode.form')}
          </button>
          <button
            type="button"
            className={mode === 'json' ? 'active' : ''}
            onClick={() => {
              if (definition.value) setJson(JSON.stringify(definition.value, null, 2));
              setMode('json');
            }}
          >
            {t('tariffs.editor.mode.json')}
          </button>
        </div>
      </div>
      {!initialForm && latest ? <Alert tone="info">{t('tariffs.editor.jsonOnly')}</Alert> : null}
      <ErrorBox error={mutation.error} />
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <div className="grid cols-2 editor-grid">
        <div>
          {mode === 'form' ? (
            <>
              <h3>{t('tariffs.editor.energy')}</h3>
              <Field
                label={`${t('tariffs.editor.energyPrice')} (${priceLabel})`}
                help={t('tariffs.editor.energyHelp')}
              >
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={form.energyPrice}
                  onChange={(e) => update('energyPrice', e.target.value)}
                  required
                  placeholder="1350"
                />
              </Field>
              <div className="muted small mb">{t('tariffs.editor.bandsHelp')}</div>
              {form.bands.map((band, index) => (
                <div className="mb band" key={`band-${index.toString()}`}>
                  <label className="field inline">
                    <span>{t('tariffs.editor.from')}</span>
                    <input
                      type="time"
                      value={band.start}
                      onChange={(e) => updateBand(index, { start: e.target.value })}
                      required
                    />
                  </label>
                  <label className="field inline">
                    <span>{t('tariffs.editor.to')}</span>
                    <input
                      type="time"
                      value={band.end}
                      onChange={(e) => updateBand(index, { end: e.target.value })}
                      required
                    />
                  </label>
                  <label className="field inline">
                    <span>{t('tariffs.editor.days')}</span>
                    <select
                      value={band.days}
                      onChange={(e) => updateBand(index, { days: e.target.value as DayPreset })}
                    >
                      {DAY_PRESET_OPTIONS.map((preset) => (
                        <option key={preset} value={preset}>
                          {t(`tariffs.editor.days.${preset}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field inline">
                    <span>{priceLabel}/kWh</span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={band.price}
                      onChange={(e) => updateBand(index, { price: e.target.value })}
                      required
                    />
                  </label>
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      update(
                        'bands',
                        form.bands.filter((_, i) => i !== index),
                      )
                    }
                  >
                    {t('tariffs.editor.remove')}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="small mb"
                onClick={() =>
                  update('bands', [
                    ...form.bands,
                    { start: '05:00', end: '20:00', price: form.energyPrice, days: 'ALL' },
                  ])
                }
              >
                {t('tariffs.editor.addBand')}
              </button>

              <h3>{t('tariffs.editor.idle')}</h3>
              <label className="check mb">
                <input
                  type="checkbox"
                  checked={form.idleEnabled}
                  onChange={(e) => update('idleEnabled', e.target.checked)}
                />
                {t('tariffs.editor.idleEnabled')}
              </label>
              {form.idleEnabled ? (
                <div className="grid cols-3">
                  <Field label={t('tariffs.editor.idleGrace')}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={form.idleGraceMin}
                      onChange={(e) => update('idleGraceMin', e.target.value)}
                      required
                    />
                  </Field>
                  <Field label={`${t('tariffs.editor.idlePrice')} (${priceLabel})`}>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={form.idlePricePerMinute}
                      onChange={(e) => update('idlePricePerMinute', e.target.value)}
                      required
                    />
                  </Field>
                  <Field label={t('tariffs.editor.idleMax')}>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={form.idleMaxMin}
                      onChange={(e) => update('idleMaxMin', e.target.value)}
                    />
                  </Field>
                  <Field label={t('tariffs.editor.idleStart')}>
                    <select
                      value={form.idleStart}
                      onChange={(e) => update('idleStart', e.target.value as IdleStart)}
                    >
                      {IDLE_STARTS.map((start) => (
                        <option key={start} value={start}>
                          {t(`tariffs.editor.idleStart.${start}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : null}

              <h3>{t('tariffs.editor.extras')}</h3>
              <div className="grid cols-2">
                <Field label={`${t('tariffs.editor.sessionFee')} (${priceLabel})`}>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={form.sessionFee}
                    onChange={(e) => update('sessionFee', e.target.value)}
                  />
                </Field>
                <Field
                  label={`${t('tariffs.editor.timePrice')} (${priceLabel})`}
                  help={t('tariffs.editor.timeHelp')}
                >
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={form.timePricePerMinute}
                    onChange={(e) => update('timePricePerMinute', e.target.value)}
                  />
                </Field>
              </div>

              <h3>{t('tariffs.editor.tax')}</h3>
              <div className="grid cols-3">
                <Field label={t('tariffs.editor.vat')} help={t('tariffs.editor.vatHelp')}>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    value={form.vat}
                    onChange={(e) => update('vat', e.target.value)}
                  />
                </Field>
                <Field label={`${t('tariffs.editor.minPrice')} (${priceLabel})`}>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={form.minPrice}
                    onChange={(e) => update('minPrice', e.target.value)}
                  />
                </Field>
                <Field label={`${t('tariffs.editor.maxPrice')} (${priceLabel})`}>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={form.maxPrice}
                    onChange={(e) => update('maxPrice', e.target.value)}
                  />
                </Field>
              </div>
              <label className="check mb">
                <input
                  type="checkbox"
                  checked={taxIncluded}
                  onChange={(e) => setTaxIncluded(e.target.checked)}
                />
                {t('tariffs.editor.taxIncluded')}
              </label>
              <Field
                label={t('tariffs.editor.description')}
                help={t('tariffs.editor.descriptionHelp')}
              >
                <input
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  maxLength={512}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label={t('tariffs.definition')}>
                <textarea
                  value={json}
                  onChange={(e) => {
                    setJson(e.target.value);
                    setValidation(null);
                    setExample(null);
                  }}
                  rows={22}
                />
              </Field>
              <label className="check mb">
                <input
                  type="checkbox"
                  checked={taxIncluded}
                  onChange={(e) => setTaxIncluded(e.target.checked)}
                />
                {t('tariffs.editor.taxIncluded')}
              </label>
            </>
          )}
          <Field label={t('tariffs.notes')}>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Field>
        </div>
        <aside className="preview">
          <h3>{t('tariffs.editor.preview')}</h3>
          {definition.error ? <Alert tone="warning">{definition.error}</Alert> : null}
          {summary.length ? (
            <ul className="summary">
              {summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {validation ? (
            <Alert tone={validation.ok ? 'ok' : 'error'}>
              {validation.message}
              {validation.warnings.length ? (
                <ul className="warnings">
                  {validation.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}
          {example ? (
            <div className="example">
              <div className="muted small">{t('tariffs.editor.example')}</div>
              <div className="row between">
                <strong>{t('tariffs.editor.exampleTotal')}</strong>
                <span className="kpi-inline">
                  {money(example.totalMinor, example.currency, locale)}
                </span>
              </div>
              <ul className="summary small">
                {example.lines.map((line) => (
                  <li key={line.seq}>
                    {td(`sessions.dimension.${line.dimension}`)}: {quantity(line, locale)} ·{' '}
                    {moneyMajor(line.total, example.currency, locale)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <details className="mt">
            <summary className="small muted">{t('tariffs.definition')}</summary>
            <JsonView value={definition.value ?? definition.error} />
          </details>
        </aside>
      </div>
      <div className="form-actions">
        <button type="button" onClick={onCancel}>
          {t('app.cancel')}
        </button>
        <button type="button" onClick={() => void validate()} disabled={!definition.value}>
          {t('tariffs.validate')}
        </button>
        <button type="submit" className="primary" disabled={mutation.busy || !definition.value}>
          {t('tariffs.editor.saveDraft')}
        </button>
      </div>
    </form>
  );
}

export function TariffDetailPage({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const tariff = useQuery(() => api.get<TariffDetail>(`/tariffs/${id}`), [id]);
  const { scopeLabel } = useScopeLabels();
  const mutation = useMutation();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<TariffVersion | null>(null);
  const [publishAt, setPublishAt] = useState('');
  const [confirm, setConfirm] = useState<{
    title: string;
    message?: string;
    /** Publicación: la acción se arma al confirmar con la fecha elegida. */
    publishVersion?: number;
    action?: () => Promise<unknown>;
  } | null>(null);

  if (tariff.error && !tariff.data) return <ErrorBox error={tariff.error} />;
  if (!tariff.data) return <Loading />;
  const tf = tariff.data;
  const latest = tf.versions.at(-1);
  const active = tf.versions.find((v) => v.status === 'ACTIVE');
  const openAssignments = tf.assignments.filter((a) => !a.valid_to);

  return (
    <>
      <PageHeader
        title={`${tf.code} · ${tf.name}`}
        actions={
          auth.can('pricing:write') ? (
            <button type="button" className="primary" onClick={() => setEditing((v) => !v)}>
              {t('tariffs.newVersion')}
            </button>
          ) : null
        }
        onBack={() => navigate('/tariffs')}
      />
      <ErrorBox error={mutation.error} />
      {notice ? <Alert tone="ok">{notice}</Alert> : null}
      {editing ? (
        <VersionEditor
          tariff={tf}
          latest={latest}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice(t('tariffs.versionSaved'));
            void tariff.reload();
          }}
        />
      ) : null}
      <div className="grid cols-2">
        <div className="card">
          <h2>{t('tariffs.activeNow')}</h2>
          {active ? (
            <>
              <div className="row mb">
                <Badge tone="ok">v{active.version}</Badge>
                <span className="muted small">
                  {t('tariffs.validFrom')} {dateTime(active.valid_from, locale)}
                  {active.valid_to
                    ? ` · ${t('tariffs.validTo')} ${dateTime(active.valid_to, locale)}`
                    : ''}
                </span>
              </div>
              <ul className="summary">
                {describeTariff(active.definition, locale).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : (
            <Alert tone="warning">{t('tariffs.noActive')}</Alert>
          )}
        </div>
        <div className="card">
          <h2>{t('tariffs.assignments')}</h2>
          {openAssignments.length === 0 ? (
            <Alert tone="warning">{t('tariffs.noAssignments')}</Alert>
          ) : (
            <ul className="summary">
              {openAssignments.map((a) => (
                <li key={a.id}>
                  {scopeLabel(a)} · {a.segment}
                </li>
              ))}
            </ul>
          )}
          <p className="help">{t('tariffs.assignmentsWhere')}</p>
        </div>
      </div>
      <div className="card">
        <h2>{t('tariffs.versions')}</h2>
        <DataTable
          rows={tf.versions}
          rowKey={(v) => v.id}
          onRowClick={(v) => setSelected(v)}
          columns={[
            {
              key: 'v',
              header: t('tariffs.version'),
              render: (v) => <strong>v{v.version}</strong>,
            },
            {
              key: 'status',
              header: t('app.status'),
              render: (v) => (
                <Badge tone={versionTone(v.status)}>
                  {t(`tariffs.status.${v.status}` as MessageKey) === `tariffs.status.${v.status}`
                    ? v.status
                    : t(`tariffs.status.${v.status}` as MessageKey)}
                </Badge>
              ),
            },
            {
              key: 'summary',
              header: t('tariffs.summary'),
              render: (v) => (
                <span className="small">{describeTariff(v.definition, locale)[0] ?? '—'}</span>
              ),
            },
            {
              key: 'from',
              header: t('tariffs.validFrom'),
              render: (v) => dateTime(v.valid_from, locale),
            },
            {
              key: 'to',
              header: t('tariffs.validTo'),
              render: (v) => dateTime(v.valid_to, locale),
            },
            {
              key: 'by',
              header: t('audit.actor'),
              render: (v) => <code>{v.approved_by ?? v.created_by}</code>,
            },
            {
              key: 'act',
              header: '',
              render: (v) =>
                auth.can('pricing:publish') ? (
                  <span className="row">
                    {v.status === 'DRAFT' ? (
                      <button
                        type="button"
                        className="small primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPublishAt('');
                          setConfirm({
                            title: `${t('tariffs.publish')} v${v.version}`,
                            message: t('tariffs.publishConfirm'),
                            publishVersion: v.version,
                          });
                        }}
                      >
                        {t('tariffs.publish')}
                      </button>
                    ) : null}
                    {v.status === 'ACTIVE' || v.status === 'SCHEDULED' ? (
                      <button
                        type="button"
                        className="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirm({
                            title: `${t('tariffs.retire')} v${v.version}`,
                            action: () => api.post(`/tariffs/${id}/versions/${v.version}/retire`),
                          });
                        }}
                      >
                        {t('tariffs.retire')}
                      </button>
                    ) : null}
                  </span>
                ) : null,
            },
          ]}
        />
        {selected ? (
          <div className="mt">
            <h3>
              v{selected.version} · {t('tariffs.summary')}
            </h3>
            {selected.notes ? <p className="muted">{selected.notes}</p> : null}
            <ul className="summary">
              {describeTariff(selected.definition, locale).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <details>
              <summary className="small muted">{t('tariffs.definition')}</summary>
              <JsonView value={selected.definition} />
            </details>
          </div>
        ) : null}
      </div>
      <div className="card">
        <h2>{t('tariffs.assignmentHistory')}</h2>
        <AssignmentsTable
          rows={tf.assignments}
          tariffCode={() => tf.code}
          scopeLabel={scopeLabel}
        />
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message}
        busy={mutation.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const current = confirm;
          setConfirm(null);
          if (!current) return;
          setNotice(null);
          const version = current.publishVersion;
          const action =
            version !== undefined
              ? () =>
                  api.post(
                    `/tariffs/${id}/versions/${version}/publish`,
                    publishAt ? { validFrom: new Date(publishAt).toISOString() } : {},
                  )
              : current.action;
          if (action) await mutation.run(action);
          void tariff.reload();
        }}
      >
        {confirm?.publishVersion !== undefined ? (
          <Field label={t('tariffs.publishAt')}>
            <input
              type="datetime-local"
              value={publishAt}
              min={localDateTime(-1)}
              onChange={(e) => setPublishAt(e.target.value)}
            />
          </Field>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
