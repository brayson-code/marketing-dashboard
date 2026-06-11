'use client';

// The signature visual of the new Overview — a glowing department-colored orb
// that identifies each agent at a glance. Sizes correspond to context:
//   sm  → inline in queue rows + activity feeds
//   md  → next to an agent name in lists
//   lg  → the hero C-suite cards (top-right corner)
//
// Color is derived from `department`; pass a custom hex to override.

export type Department = 'leadership' | 'marketing' | 'revenue' | 'operations' | 'client_experience';

const DEPT_COLOR_VAR: Record<Department, string> = {
  leadership: 'var(--dept-leadership)',
  marketing: 'var(--dept-marketing)',
  revenue: 'var(--dept-revenue)',
  operations: 'var(--dept-operations)',
  client_experience: 'var(--dept-client-experience)',
};

const SIZE_PX: Record<'sm' | 'md' | 'lg', number> = { sm: 18, md: 28, lg: 56 };

export function AgentOrb({
  department,
  size = 'md',
  color,
  pulse = true,
}: {
  department?: Department;
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  pulse?: boolean;
}) {
  const px = SIZE_PX[size];
  const c = color ?? (department ? DEPT_COLOR_VAR[department] : 'var(--primary)');
  const glow = size === 'lg' ? `0 0 ${px * 0.9}px ${c}, 0 0 ${px * 0.45}px ${c}` : `0 0 ${px * 0.6}px ${c}`;
  return (
    <span
      aria-hidden
      className={pulse ? 'agent-orb agent-orb--pulse' : 'agent-orb'}
      style={{
        display: 'inline-block',
        width: px,
        height: px,
        borderRadius: '50%',
        background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${c} 70%, white), ${c} 55%, color-mix(in srgb, ${c} 30%, #000) 100%)`,
        boxShadow: glow,
        filter: 'saturate(1.2)',
      }}
    />
  );
}

export function colorForDepartment(dept?: Department | null): string {
  return dept ? DEPT_COLOR_VAR[dept] : 'var(--primary)';
}

export const DEPT_LABEL: Record<Department, string> = {
  leadership: 'Leadership',
  marketing: 'Marketing',
  revenue: 'Revenue',
  operations: 'Operations',
  client_experience: 'Client Experience',
};
