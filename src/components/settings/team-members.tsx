'use client';

// Team / Members — owner-facing membership management (Settings → Team tab).
//
// Lists the active workspace's members (email, role, grants), lets the OWNER change a
// member's role (owner|member|va), remove a member (with confirm), and toggle a
// member/VA's grantable capabilities (content_write, crm_write, approve, publish,
// view_audit). Every action calls /api/members, which is OWNER-ONLY server-side — this
// component additionally hides its controls unless the viewer is the owner
// (defense-in-depth; the API is the real gate). "Add teammate" deep-links to the
// existing invite flow rather than duplicating it.

import { useEffect, useState, useCallback } from 'react';
import { Users, Trash2, UserPlus, ShieldCheck } from 'lucide-react';
import { toast } from '@/components/ui/toast';

type WorkspaceRole = 'owner' | 'member' | 'va';

interface GrantableCap {
  key: string;
  label: string;
}

interface Member {
  user_id: string;
  role: WorkspaceRole;
  email: string | null;
  grants: Record<string, boolean>;
  created_at: string | null;
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  member: 'Member',
  va: 'VA',
};

export function TeamMembers() {
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [grantable, setGrantable] = useState<GrantableCap[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // user_id of in-flight row

  // Resolve the viewer's role first — the API self-gates (403 for non-owners), but we
  // hide the controls so a non-owner never sees actions they can't take.
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { user?: { id?: string; workspace_role?: WorkspaceRole } }) => {
        setIsOwner(data.user?.workspace_role === 'owner');
        setMyUserId(data.user?.id ?? null);
      })
      .catch(() => setIsOwner(false));
  }, []);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/members', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load members');
      setMembers(Array.isArray(data.members) ? data.members : []);
      setGrantable(Array.isArray(data.grantable) ? data.grantable : []);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOwner) loadMembers();
    else if (isOwner === false) setLoading(false);
  }, [isOwner, loadMembers]);

  async function changeRole(member: Member, role: WorkspaceRole) {
    if (role === member.role) return;
    setBusy(member.user_id);
    try {
      const res = await fetch('/api/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: member.user_id, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change role');
      toast.success(`Role updated to ${ROLE_LABELS[role]}`);
      await loadMembers();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleGrant(member: Member, capKey: string, next: boolean) {
    setBusy(member.user_id);
    try {
      const grants = { ...member.grants, [capKey]: next };
      const res = await fetch('/api/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: member.user_id, grants }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update capabilities');
      toast.success('Capabilities updated');
      await loadMembers();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(member: Member) {
    const who = member.email || member.user_id;
    if (!confirm(`Remove ${who} from this workspace? Their sessions will be revoked immediately.`)) return;
    setBusy(member.user_id);
    try {
      const res = await fetch('/api/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: member.user_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove member');
      toast.success(`Removed ${who}`);
      await loadMembers();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Non-owner (or still resolving the owner check) → a quiet stub. The API enforces
  // owner-only regardless; this just avoids dangling controls.
  if (isOwner === null) {
    return (
      <div className="panel p-5">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!isOwner) {
    return (
      <div className="panel p-5 space-y-2">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Users size={14} className="text-primary" /> Team
        </h2>
        <p className="text-xs text-muted-foreground">
          Only the workspace owner can manage teammates and their permissions.
        </p>
      </div>
    );
  }

  return (
    <div className="panel p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Users size={14} className="text-primary" /> Team & permissions
        </h2>
        <a href="/clients" className="btn btn-ghost btn-sm w-fit inline-flex items-center gap-1.5">
          <UserPlus size={13} /> Add teammate
        </a>
      </div>
      <p className="text-xs text-muted-foreground">
        Manage who can act in this workspace. Roles set the baseline; per-member
        capabilities below grant a member or VA specific abilities on top of their role.
        Owner-only powers (billing, plan, workspace deletion, secret rotation, member
        management) can never be delegated.
      </p>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading members…</div>
      ) : members.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No members yet. Invite a teammate to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((m) => {
            const isSelf = myUserId != null && m.user_id === myUserId;
            const rowBusy = busy === m.user_id;
            return (
              <div
                key={m.user_id}
                className="rounded-xl border border-border/50 p-3 space-y-3 bg-muted/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      {m.email || m.user_id}
                      {isSelf && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {ROLE_LABELS[m.role]}
                      {!m.email && ' • id only (no email on file)'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={m.role}
                      disabled={rowBusy}
                      onChange={(e) => changeRole(m, e.target.value as WorkspaceRole)}
                      className="px-2 py-1 rounded-md border border-border bg-background text-xs disabled:opacity-50"
                    >
                      <option value="owner">Owner</option>
                      <option value="member">Member</option>
                      <option value="va">VA</option>
                    </select>
                    <button
                      type="button"
                      disabled={rowBusy}
                      onClick={() => removeMember(m)}
                      className="btn btn-destructive text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-50"
                      title="Remove member"
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                  </div>
                </div>

                {/* Grantable capabilities — owner-only set is never shown here. */}
                {grantable.length > 0 && (
                  <div className="space-y-1.5 border-t border-border/30 pt-2.5">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <ShieldCheck size={11} /> Granted capabilities
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {grantable.map((cap) => {
                        const on = m.grants?.[cap.key] === true;
                        // The owner already has everything by role — grants are a no-op
                        // for them, so show as locked-on, not toggleable.
                        const ownerImplied = m.role === 'owner';
                        return (
                          <button
                            key={cap.key}
                            type="button"
                            disabled={rowBusy || ownerImplied}
                            onClick={() => toggleGrant(m, cap.key, !on)}
                            aria-pressed={on || ownerImplied}
                            className={[
                              'rounded-full px-2.5 py-1 text-[11px] border transition-colors',
                              'disabled:cursor-not-allowed',
                              on || ownerImplied
                                ? 'bg-primary/15 border-primary/40 text-primary'
                                : 'bg-muted/20 border-border text-muted-foreground hover:text-foreground hover:bg-muted/40',
                            ].join(' ')}
                            title={ownerImplied ? 'Owners have every capability' : cap.label}
                          >
                            {cap.label}
                          </button>
                        );
                      })}
                    </div>
                    {m.role === 'owner' && (
                      <p className="text-[11px] text-muted-foreground">
                        Owners have every capability — grants apply to members and VAs.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
