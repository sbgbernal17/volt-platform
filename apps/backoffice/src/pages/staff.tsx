import { type FormEvent, useState } from 'react';
import { useApi, useAuth } from '../auth/auth.tsx';
import { ConfirmDialog } from '../components/confirm-dialog.tsx';
import { DataTable } from '../components/data-table.tsx';
import { Alert, Badge, ErrorBox, Field, Loading, PageHeader } from '../components/ui.tsx';
import { type MessageKey, useI18n } from '../i18n/index.tsx';
import { dateTime } from '../lib/format.ts';
import type { Items, Site, StaffUser } from '../lib/types.ts';
import { useMutation, useQuery } from '../lib/use-query.ts';

const ROLES = ['ADMIN', 'OPERATIONS', 'SUPPORT', 'READ_ONLY', 'SITE_OWNER'] as const;

export function StaffPage() {
  const { t, locale } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const staff = useQuery(() => api.get<Items<StaffUser>>('/staff'), []);
  const sites = useQuery(() => api.get<Items<Site>>('/sites'), []);
  const mutation = useMutation();
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({
    email: '',
    displayName: '',
    role: 'OPERATIONS',
    siteIds: [] as string[],
    locale: 'es',
  });
  const [confirm, setConfirm] = useState<{
    title: string;
    danger?: boolean;
    action: (reason: string) => Promise<unknown>;
  } | null>(null);
  const canManage = auth.can('staff:manage');

  const invite = (event: FormEvent) => {
    event.preventDefault();
    void mutation
      .run(
        () =>
          api.post('/staff', {
            email: form.email.trim(),
            displayName: form.displayName.trim() || undefined,
            role: form.role,
            siteIds: form.role === 'SITE_OWNER' ? form.siteIds : undefined,
            locale: form.locale,
          }),
        t('staff.invited'),
      )
      .then((created) => {
        if (created) {
          setInviting(false);
          setForm({ email: '', displayName: '', role: 'OPERATIONS', siteIds: [], locale: 'es' });
          void staff.reload();
        }
      });
  };
  const changeRole = (user: StaffUser, role: string) => {
    if (role === user.role) return;
    setConfirm({
      title: `${t('staff.role')}: ${user.email} → ${role}`,
      action: (reason) =>
        api.patch(`/staff/${user.id}`, {
          role,
          reason,
          siteIds: role === 'SITE_OWNER' ? user.site_ids : undefined,
        }),
    });
  };

  return (
    <>
      <PageHeader
        title={t('staff.title')}
        actions={
          canManage ? (
            <button type="button" className="primary" onClick={() => setInviting((v) => !v)}>
              {t('staff.invite')}
            </button>
          ) : null
        }
      />
      <ErrorBox error={mutation.error} />
      {mutation.message ? <Alert tone="ok">{mutation.message}</Alert> : null}
      {inviting ? (
        <form className="card" onSubmit={invite}>
          <div className="grid cols-3">
            <Field label={t('staff.email')}>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </Field>
            <Field label={t('staff.name')}>
              <input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </Field>
            <Field label={t('staff.role')} help={t(`staff.roleHelp.${form.role}` as MessageKey)}>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            {form.role === 'SITE_OWNER' ? (
              <Field label={t('staff.sites')}>
                <select
                  multiple
                  value={form.siteIds}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      siteIds: Array.from(e.target.selectedOptions).map((o) => o.value),
                    })
                  }
                  size={4}
                >
                  {sites.data?.items.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label={t('app.language')}>
              <select
                value={form.locale}
                onChange={(e) => setForm({ ...form, locale: e.target.value })}
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" onClick={() => setInviting(false)}>
              {t('app.cancel')}
            </button>
            <button type="submit" className="primary" disabled={mutation.busy}>
              {t('staff.invite')}
            </button>
          </div>
        </form>
      ) : null}
      <div className="card">
        <ErrorBox error={staff.error} />
        {staff.loading ? <Loading /> : null}
        <DataTable
          rows={staff.data?.items ?? []}
          rowKey={(u) => u.id}
          columns={[
            {
              key: 'email',
              header: t('staff.email'),
              render: (u) => (
                <>
                  <strong>{u.email}</strong>
                  {u.id === auth.me?.id ? (
                    <>
                      {' '}
                      <Badge tone="primary">{t('staff.me')}</Badge>
                    </>
                  ) : null}
                  <div className="small muted">{u.display_name ?? ''}</div>
                </>
              ),
            },
            {
              key: 'role',
              header: t('staff.role'),
              render: (u) =>
                canManage && u.id !== auth.me?.id ? (
                  <select
                    value={u.role}
                    onChange={(e) => changeRole(u, e.target.value)}
                    style={{ width: 150 }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  u.role
                ),
            },
            {
              key: 'sites',
              header: t('staff.sites'),
              render: (u) =>
                u.role === 'SITE_OWNER'
                  ? u.site_ids
                      .map(
                        (id) => sites.data?.items.find((s) => s.id === id)?.code ?? id.slice(0, 8),
                      )
                      .join(', ')
                  : '—',
            },
            {
              key: 'status',
              header: t('staff.status'),
              render: (u) => (
                <Badge
                  tone={u.status === 'ACTIVE' ? 'ok' : u.status === 'INVITED' ? 'info' : 'danger'}
                >
                  {u.status}
                </Badge>
              ),
            },
            {
              key: 'linked',
              header: t('staff.linked'),
              render: (u) => (u.linked ? t('app.yes') : t('app.no')),
            },
            {
              key: 'mfa',
              header: t('staff.mfa'),
              render: (u) => (u.mfa_enrolled ? t('app.yes') : t('app.no')),
            },
            {
              key: 'login',
              header: t('staff.lastLogin'),
              render: (u) => dateTime(u.last_login_at, locale),
            },
            {
              key: 'act',
              header: '',
              render: (u) =>
                canManage && u.id !== auth.me?.id ? (
                  u.status === 'DISABLED' ? (
                    <button
                      type="button"
                      className="small"
                      onClick={() =>
                        setConfirm({
                          title: `${t('staff.enable')} ${u.email}`,
                          action: () => api.patch(`/staff/${u.id}`, { status: 'ACTIVE' }),
                        })
                      }
                    >
                      {t('staff.enable')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="small"
                      onClick={() =>
                        setConfirm({
                          title: `${t('staff.disable')} ${u.email}`,
                          danger: true,
                          action: (reason) =>
                            api.patch(`/staff/${u.id}`, { status: 'DISABLED', reason }),
                        })
                      }
                    >
                      {t('staff.disable')}
                    </button>
                  )
                ) : null,
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
            void staff.reload();
          }
        }}
      />
    </>
  );
}
