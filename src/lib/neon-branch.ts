/**
 * Neon 分支快照。
 *
 * Neon 的分支是写时复制的即时快照 —— 建一个几乎不占空间也不花时间，
 * 需要回滚时在 Neon 面板上点几下就能把数据捞回来，比导出 JSON 再手工导回方便得多。
 *
 * 防的是：误删数据、写坏数据、超过免费档 6 小时回溯窗口才发现。
 * **不防**：Neon 项目或账号本身没了 —— 那由 /api/export 那一层兜。
 */

const API = 'https://console.neon.tech/api/v2';

/** 免费档最多 10 个分支，留两个余量给主分支和临时用途。 */
const KEEP = 8;

const PREFIX = 'backup-';

type Branch = { id: string; name: string; created_at: string; default?: boolean };

function config() {
  const key = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!key) throw new Error('NEON_API_KEY 未配置');
  if (!projectId) throw new Error('NEON_PROJECT_ID 未配置');
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

  // 修剪旧快照，别撞上免费档的分支数上限
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
