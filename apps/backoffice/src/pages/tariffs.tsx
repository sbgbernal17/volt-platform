import { type FormEvent, useState } from 'react';
import { useApi, useAuth } from '../auth/auth.tsx';
import { ConfirmDialog } from '../components/confirm-dialog.tsx';
import { DataTable } from '../components/data-table.tsx';
import { Alert, Badge, ErrorBox, Field, JsonView, Loading, PageHeader } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { dateTime } from '../lib/format.ts';
import { useRouter } from '../lib/router.tsx';
import type { Items } from '../lib/types.ts';
import { useMutation, useQuery } from '../lib/use-query.ts';

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

function versionTone(status: string): 'ok' | 'info' | 'neutral' {
  if (status === 'ACTIVE') return 'ok';
  if (status === 'DRAFT' || status === 'SCHEDULED') return 'info';
  return 'neutral';
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
  const mutation = useMutation();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', currency: 'COP' });
  const [assigning, setAssigning] = useState(false);
  const [assignment, setAssignment] = useState({
    scopeType: 'TENANT',
    scopeId: '',
    segment: 'PUBLIC',
    tariffId: '',
    priority: '0',
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
  const assign = (event: FormEvent) => {
    event.preventDefault();
    void mutation
      .run(() =>
        api.post('/tariff-assignments', {
          scopeType: assignment.scopeType,
          scopeId: assignment.scopeType === 'TENANT' ? undefined : assignment.scopeId,
          segment: assignment.segment,
          tariffId: assignment.tariffId,
          priority: Number(assignment.priority),
        }),
      )
      .then(() => {
        setAssigning(false);
        void assignments.reload();
      });
  };
  const tariffCode = (id: string) =>
    tariffs.data?.items.find((x) => x.id === id)?.code ?? id.slice(0, 8);

  return (
    <>
      <PageHeader
        title={t('tariffs.title')}
        actions={
          <>
            {auth.can('pricing:write') ? (
              <button
                type="button"
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
      <ErrorBox error={mutation.error} />
      {creating ? (
        <form className="card" onSubmit={create}>
          <div className="grid cols-3">
            <Field label={t('tariffs.code')}>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                required
                minLength={2}
                maxLength={36}
              />
            </Field>
            <Field label={t('tariffs.name')}>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                maxLength={120}
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
          <div className="grid cols-4">
            <Field label={t('tariffs.scope')}>
              <select
                value={assignment.scopeType}
                onChange={(e) => setAssignment({ ...assignment, scopeType: e.target.value })}
              >
                {['TENANT', 'SITE', 'CHARGE_POINT', 'EVSE', 'CONNECTOR'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('tariffs.scopeId')}>
              <input
                value={assignment.scopeId}
                onChange={(e) => setAssignment({ ...assignment, scopeId: e.target.value })}
                disabled={assignment.scopeType === 'TENANT'}
              />
            </Field>
            <Field label={t('tariffs.segment')}>
              <input
                value={assignment.segment}
                onChange={(e) =>
                  setAssignment({ ...assignment, segment: e.target.value.toUpperCase() })
                }
                required
              />
            </Field>
            <Field label={t('tariffs.title')}>
              <select
                value={assignment.tariffId}
                onChange={(e) => setAssignment({ ...assignment, tariffId: e.target.value })}
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
            <Field label={t('tariffs.priority')}>
              <input
                type="number"
                value={assignment.priority}
                onChange={(e) => setAssignment({ ...assignment, priority: e.target.value })}
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
        <ErrorBox error={tariffs.error} />
        {tariffs.loading ? <Loading /> : null}
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
                x.active_version ? <Badge tone="ok">v{x.active_version}</Badge> : '—',
            },
            {
              key: 'created',
              header: t('app.created'),
              render: (x) => dateTime(x.created_at, locale),
            },
          ]}
        />
      </div>
      <div className="card">
        <h2>{t('tariffs.assignments')}</h2>
        <DataTable
          rows={assignments.data?.items ?? []}
          rowKey={(a) => a.id}
          columns={[
            {
              key: 'scope',
              header: t('tariffs.scope'),
              render: (a) =>
                `${a.scope_type}${a.scope_type === 'TENANT' ? '' : ` · ${a.scope_id.slice(0, 8)}`}`,
            },
            { key: 'segment', header: t('tariffs.segment'), render: (a) => a.segment },
            { key: 'tariff', header: t('tariffs.title'), render: (a) => tariffCode(a.tariff_id) },
            {
              key: 'prio',
              header: t('tariffs.priority'),
              render: (a) => a.priority,
              align: 'right',
            },
            {
              key: 'from',
              header: t('tariffs.validFrom'),
              render: (a) => dateTime(a.valid_from, locale),
            },
            {
              key: 'to',
              header: t('tariffs.validTo'),
              render: (a) => dateTime(a.valid_to, locale),
            },
            {
              key: 'act',
              header: '',
              render: (a) =>
                auth.can('pricing:publish') && !a.valid_to ? (
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      setConfirm({
                        title: `${t('tariffs.end')} ${tariffCode(a.tariff_id)}`,
                        action: () => api.post(`/tariff-assignments/${a.id}/end`),
                      })
                    }
                  >
                    {t('tariffs.end')}
                  </button>
                ) : null,
            },
          ]}
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

export function TariffDetailPage({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const { navigate } = useRouter();
  const tariff = useQuery(() => api.get<TariffDetail>(`/tariffs/${id}`), [id]);
  const mutation = useMutation();
  const [editing, setEditing] = useState(false);
  const [definition, setDefinition] = useState('');
  const [notes, setNotes] = useState('');
  const [validation, setValidation] = useState<unknown>(null);
  const [selected, setSelected] = useState<TariffVersion | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message?: string;
    action: () => Promise<unknown>;
  } | null>(null);

  const parse = (): unknown | undefined => {
    try {
      return JSON.parse(definition);
    } catch {
      setValidation({ error: 'JSON inválido' });
      return undefined;
    }
  };

  if (tariff.error && !tariff.data) return <ErrorBox error={tariff.error} />;
  if (!tariff.data) return <Loading />;
  const tf = tariff.data;
  const latest = tf.versions.at(-1);

  return (
    <>
      <PageHeader
        title={`${tf.code} · ${tf.name}`}
        actions={
          <>
            {auth.can('pricing:write') ? (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setEditing((v) => !v);
                  setDefinition(
                    JSON.stringify(
                      latest?.definition ?? { currency: tf.currency, elements: [] },
                      null,
                      2,
                    ),
                  );
                }}
              >
                {t('tariffs.newVersion')}
              </button>
            ) : null}
            <button type="button" onClick={() => navigate('/tariffs')}>
              {t('app.back')}
            </button>
          </>
        }
      />
      <ErrorBox error={mutation.error} />
      {mutation.message ? <Alert tone="ok">{mutation.message}</Alert> : null}
      {editing ? (
        <form
          className="card"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const def = parse();
            if (def === undefined) return;
            void mutation
              .run(() =>
                api.post(`/tariffs/${id}/versions`, { definition: def, notes: notes || undefined }),
              )
              .then(() => {
                setEditing(false);
                void tariff.reload();
              });
          }}
        >
          <Field label={t('tariffs.definition')}>
            <textarea
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              rows={18}
            />
          </Field>
          <Field label={t('tariffs.notes')}>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Field>
          {validation ? <JsonView value={validation} /> : null}
          <div className="form-actions">
            <button type="button" onClick={() => setEditing(false)}>
              {t('app.cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                const def = parse();
                if (def !== undefined)
                  void api
                    .post(`/tariffs/${id}/versions/validate`, { definition: def })
                    .then(setValidation)
                    .catch((err: Error) => setValidation({ error: err.message }));
              }}
            >
              {t('tariffs.validate')}
            </button>
            <button type="submit" className="primary" disabled={mutation.busy}>
              {t('app.save')}
            </button>
          </div>
        </form>
      ) : null}
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
              render: (v) => <Badge tone={versionTone(v.status)}>{v.status}</Badge>,
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
              key: 'tax',
              header: t('tariffs.taxIncluded'),
              render: (v) => (v.tax_included ? t('app.yes') : t('app.no')),
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
                          setConfirm({
                            title: `${t('tariffs.publish')} v${v.version}`,
                            message: t('tariffs.publishConfirm'),
                            action: () =>
                              api.post(`/tariffs/${id}/versions/${v.version}/publish`, {}),
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
          <>
            <h3 className="mt">
              v{selected.version} · {t('tariffs.definition')}
            </h3>
            {selected.notes ? <p className="muted">{selected.notes}</p> : null}
            <JsonView value={selected.definition} />
          </>
        ) : null}
      </div>
      <div className="card">
        <h2>{t('tariffs.assignments')}</h2>
        <DataTable
          rows={tf.assignments}
          rowKey={(a) => a.id}
          columns={[
            {
              key: 'scope',
              header: t('tariffs.scope'),
              render: (a) =>
                `${a.scope_type}${a.scope_type === 'TENANT' ? '' : ` · ${a.scope_id.slice(0, 8)}`}`,
            },
            { key: 'segment', header: t('tariffs.segment'), render: (a) => a.segment },
            {
              key: 'prio',
              header: t('tariffs.priority'),
              render: (a) => a.priority,
              align: 'right',
            },
            {
              key: 'from',
              header: t('tariffs.validFrom'),
              render: (a) => dateTime(a.valid_from, locale),
            },
            {
              key: 'to',
              header: t('tariffs.validTo'),
              render: (a) => dateTime(a.valid_to, locale),
            },
          ]}
        />
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message}
        busy={mutation.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const action = confirm?.action;
          setConfirm(null);
          if (action) {
            await mutation.run(action);
            void tariff.reload();
          }
        }}
      />
    </>
  );
}
