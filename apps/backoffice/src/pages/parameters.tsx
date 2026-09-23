import { type FormEvent, useState } from 'react';
import { useApi, useAuth } from '../auth/auth.tsx';
import { DataTable } from '../components/data-table.tsx';
import { Alert, Badge, ErrorBox, Field, Loading, PageHeader } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { dateTime } from '../lib/format.ts';
import type { Items } from '../lib/types.ts';
import { useMutation, useQuery } from '../lib/use-query.ts';

interface ParamValue {
  id: string;
  scope_type: string;
  scope_id: string | null;
  value: unknown;
  valid_from: string;
  updated_by: string;
  reason: string | null;
}
interface ParamDefinition {
  key: string;
  value_schema: unknown;
  allowed_scopes: string[];
  default_value: unknown;
  description: string | null;
  requires_restart: boolean;
  values: ParamValue[];
}

export function ParametersPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const params = useQuery(() => api.get<Items<ParamDefinition>>('/parameters'), []);
  const mutation = useMutation();
  const [editing, setEditing] = useState<ParamDefinition | null>(null);
  const [form, setForm] = useState({ scopeType: 'TENANT', scopeId: '', value: '', reason: '' });
  const [filter, setFilter] = useState('');

  const open = (definition: ParamDefinition) => {
    setEditing(definition);
    const current =
      definition.values.find((v) => v.scope_type === 'TENANT') ?? definition.values[0];
    setForm({
      scopeType: definition.allowed_scopes.includes('TENANT')
        ? 'TENANT'
        : (definition.allowed_scopes[0] ?? 'PLATFORM'),
      scopeId: '',
      value: JSON.stringify(current?.value ?? definition.default_value),
      reason: '',
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    let value: unknown;
    try {
      value = JSON.parse(form.value);
    } catch {
      return;
    }
    void mutation
      .run(
        () =>
          api.put(`/parameters/${encodeURIComponent(editing.key)}`, {
            scopeType: form.scopeType,
            scopeId:
              form.scopeType === 'TENANT' || form.scopeType === 'PLATFORM'
                ? undefined
                : form.scopeId,
            value,
            reason: form.reason || undefined,
          }),
        t('params.saved'),
      )
      .then(() => {
        setEditing(null);
        void params.reload();
      });
  };

  const rows = (params.data?.items ?? []).filter(
    (d) =>
      !filter ||
      d.key.includes(filter) ||
      (d.description ?? '').toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title={t('params.title')}
        actions={
          <input
            placeholder={t('app.search')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 240 }}
          />
        }
      />
      <ErrorBox error={mutation.error} />
      {mutation.message ? <Alert tone="ok">{mutation.message}</Alert> : null}
      {editing ? (
        <form className="card" onSubmit={submit}>
          <h2>
            {t('params.set')}: <code>{editing.key}</code>
          </h2>
          <p className="help">{editing.description}</p>
          <div className="grid cols-3">
            <Field label={t('params.scopeType')}>
              <select
                value={form.scopeType}
                onChange={(e) => setForm({ ...form, scopeType: e.target.value })}
              >
                {editing.allowed_scopes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('params.scopeId')}>
              <input
                value={form.scopeId}
                onChange={(e) => setForm({ ...form, scopeId: e.target.value })}
                disabled={form.scopeType === 'TENANT' || form.scopeType === 'PLATFORM'}
              />
            </Field>
            <Field label={t('params.value')} help={JSON.stringify(editing.value_schema)}>
              <input
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                required
                className="mono"
              />
            </Field>
            <Field label={t('app.reason')}>
              <input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                maxLength={300}
              />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" onClick={() => setEditing(null)}>
              {t('app.cancel')}
            </button>
            <button type="submit" className="primary" disabled={mutation.busy}>
              {t('app.save')}
            </button>
          </div>
        </form>
      ) : null}
      <div className="card">
        <ErrorBox error={params.error} />
        {params.loading ? <Loading /> : null}
        <DataTable
          rows={rows}
          rowKey={(d) => d.key}
          columns={[
            {
              key: 'key',
              header: t('params.key'),
              render: (d) => (
                <>
                  <code>{d.key}</code>
                  {d.requires_restart ? (
                    <>
                      {' '}
                      <Badge tone="warning">{t('params.restart')}</Badge>
                    </>
                  ) : null}
                  <div className="small muted">{d.description}</div>
                </>
              ),
            },
            {
              key: 'default',
              header: t('params.default'),
              render: (d) => <code>{JSON.stringify(d.default_value)}</code>,
            },
            {
              key: 'scopes',
              header: t('params.scopes'),
              render: (d) => d.allowed_scopes.join(', '),
              className: 'small',
            },
            {
              key: 'values',
              header: t('params.values'),
              render: (d) =>
                d.values.length === 0 ? (
                  '—'
                ) : (
                  <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
                    {d.values.map((v) => (
                      <li key={v.id}>
                        <code>{JSON.stringify(v.value)}</code> · {v.scope_type}
                        {v.scope_id ? ` ${v.scope_id.slice(0, 8)}` : ''} ·{' '}
                        {dateTime(v.valid_from, locale)} · {v.updated_by}
                        {v.reason ? ` · ${v.reason}` : ''}
                      </li>
                    ))}
                  </ul>
                ),
            },
            {
              key: 'act',
              header: '',
              render: (d) =>
                auth.can('params:write') ? (
                  <button type="button" className="small" onClick={() => open(d)}>
                    {t('params.set')}
                  </button>
                ) : null,
            },
          ]}
        />
      </div>
    </>
  );
}
