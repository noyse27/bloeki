import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../api';

export interface Invite {
  inviteId: string;
  code: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  createdByUsername: string;
}

// Delegated (non-admin) users get a fixed, server-enforced max-uses-per-
// invite (see MAX_USES_FOR_DELEGATED_USERS in backend/src/routes/invites.ts)
// - shown here for display only, not editable, so this field can't be used
// to work around the monthly invite-code quota by setting one code's uses
// arbitrarily high. Only admins get the editable input.
const MAX_USES_FOR_DELEGATED_USERS = 1;

// Shared by AdminPage (admins see everyone's invites) and InvitesPage
// (delegated non-admin users see only their own) - GET/POST /invites is
// already scoped that way server-side, see backend/src/routes/invites.ts.
export function InvitesSection({
  token,
  isAdmin,
  collapsible = false,
}: {
  token: string;
  isAdmin: boolean;
  collapsible?: boolean;
}) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [maxUses, setMaxUses] = useState(5);
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [creating, setCreating] = useState(false);

  function load() {
    apiFetch<{ invites: Invite[] }>('/invites', { token })
      .then((r) => setInvites(r.invites))
      .catch(() => {});
  }
  useEffect(load, [token]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      await apiFetch('/invites', { method: 'POST', body: { maxUses, expiresInDays }, token });
      load();
    } finally {
      setCreating(false);
    }
  }

  async function handleDisable(inviteId: string) {
    await apiFetch(`/invites/${inviteId}/disable`, { method: 'POST', token });
    load();
  }

  const content = (
    <>
      <form className="admin-inline-form" onSubmit={handleCreate}>
        {isAdmin ? (
          <input
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
            style={{ width: 90 }}
            title="Max. Nutzungen"
          />
        ) : (
          <span title="Nur Admins können das anpassen" style={{ color: 'var(--sh-text-dim)', fontSize: 13 }}>
            Max. Nutzungen: {MAX_USES_FOR_DELEGATED_USERS}
          </span>
        )}
        <input
          type="number"
          min={1}
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(Number(e.target.value))}
          style={{ width: 110 }}
          title="Gültig für (Tage)"
        />
        <button className="admin-btn-sm" type="submit" disabled={creating}>
          Neue Einladung
        </button>
      </form>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Erstellt von</th>
              <th>Nutzung</th>
              <th>Läuft ab</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.inviteId}>
                <td>
                  <code>{inv.code}</code>
                </td>
                <td>{inv.createdByUsername}</td>
                <td>
                  {inv.usedCount}/{inv.maxUses}
                </td>
                <td>{inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : '—'}</td>
                <td>
                  {inv.disabledAt ? (
                    <span className="admin-pill bad">deaktiviert</span>
                  ) : (
                    <span className="admin-pill">aktiv</span>
                  )}
                </td>
                <td>
                  {!inv.disabledAt && (
                    <button className="admin-btn-sm" onClick={() => handleDisable(inv.inviteId)}>
                      Deaktivieren
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {invites.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--sh-text-faint)' }}>
                  Noch keine Einladungen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );

  // When used from AdminPage the collapsible wrapper (and its click-to-open
  // header) already lives one level up, around the whole InvitesSection
  // instance, so the section itself only mounts - and only then fires its
  // load() effect above - once the admin opens it. InvitesPage embeds this
  // directly as its main content, so there it keeps its own always-open
  // section/header.
  if (collapsible) {
    return content;
  }

  return (
    <section className="admin-section">
      <h3>Einladungen</h3>
      {content}
    </section>
  );
}
