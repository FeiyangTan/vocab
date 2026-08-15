/**
 * Neon branch snapshots.
 *
 * A Neon branch is a copy-on-write instant snapshot — creating one costs almost no space and
 * no time, and rolling back is a few clicks in the Neon console, far easier than exporting
 * JSON and importing it back by hand.
 *
 * Protects against: deleting data by mistake, corrupting data, noticing only after the free
 * tier's 6-hour restore window has passed.
 * **Does not protect against**: losing the Neon project or account itself — /api/export
 * covers that layer.
 */

const API = 'https://console.neon.tech/api/v2';

/** The free tier allows 10 branches; leave two spare for the primary and ad-hoc use. */
const KEEP = 8;

const PREFIX = 'backup-';

type Branch = { id: string; name: string; created_at: string; default?: boolean };

function config() {
  const key = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!key) throw new Error('NEON_API_KEY is not configured');
  if (!projectId) throw new Error('NEON_PROJECT_ID is not configured');
  return { key, projectId };
}

async function call(path: string, init?: RequestInit) {
  const { key } = config();
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Neon API ${init?.method ?? 'GET'} ${path} → ${response.status} ${await response.text()}`);
  }
  return response.json();
}

export async function createSnapshot(now = new Date()) {
  const { projectId } = config();
  const name = `${PREFIX}${now.toISOString().slice(0, 10)}`;

  const created = (await call(`/projects/${projectId}/branches`, {
    method: 'POST',
    body: JSON.stringify({ branch: { name } }),
  })) as { branch: Branch };

  // Prune old snapshots so we don't hit the free tier's branch limit
  const { branches } = (await call(`/projects/${projectId}/branches`)) as { branches: Branch[] };
  const snapshots = branches
    .filter((b) => b.name.startsWith(PREFIX) && !b.default)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const stale = snapshots.slice(KEEP);
  for (const b of stale) {
    await call(`/projects/${projectId}/branches/${b.id}`, { method: 'DELETE' });
  }

  return { created: created.branch.name, kept: snapshots.length - stale.length, pruned: stale.length };
}
