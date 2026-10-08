/**
 * groupSync.ts — pure group reconciliation logic (no React, unit-testable).
 *
 * The server is authoritative for public groups. reconcileGroups() merges the
 * locally cached groups with the freshly fetched server groups:
 *
 * 1. Every server group appears exactly once (de-duped by name), keeping the
 *    local membership (join state is device-local).
 * 2. Local public groups matching a server group by name are superseded by
 *    the server copy (fixes stale seeds + duplicate names).
 * 3. Ghosts are pruned: server-origin copies (creatorId 'cloud'/'admin' or
 *    legacy seed ids like 'g12') with no server match, and public groups
 *    created under a different login on this device that the server no
 *    longer has (e.g. deleted test groups).
 *
 * Kept as-is: my own groups, deal threads, private groups — and when the
 * login state is unknown we never prune (safe default).
 */
import type { CommunityGroup } from '../types';
import type { CloudGroup } from './cloud';

export function toLocalGroup(cg: CloudGroup, keep?: CommunityGroup): CommunityGroup {
  return {
    id: cg.id,
    name: cg.name,
    description: cg.description || 'A community hub.',
    creatorId: 'cloud',
    members: keep?.members ?? [],
    pendingRequests: keep?.pendingRequests ?? [],
    isPublic: true,
    storeId: cg.store_id || undefined,
    keywords: cg.keywords || [],
  };
}

export function reconcileGroups(
  prev: CommunityGroup[],
  cloudGroups: CloudGroup[],
  myEmail: string,
): CommunityGroup[] {
  const localByName = new Map<string, CommunityGroup>();
  for (const g of prev) {
    const k = g.name.trim().toLowerCase();
    if (!localByName.has(k)) localByName.set(k, g);
  }
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  const reconciled: CommunityGroup[] = [];
  // Pass 1: server groups first (authoritative, de-duped by name).
  for (const cg of cloudGroups) {
    const k = cg.name.trim().toLowerCase();
    if (seenNames.has(k)) continue;
    seenNames.add(k);
    const g = toLocalGroup(cg, localByName.get(k));
    seenIds.add(g.id);
    reconciled.push(g);
  }
  // Pass 2: local groups worth keeping.
  for (const g of prev) {
    if (seenIds.has(g.id)) continue;
    const key = g.name.trim().toLowerCase();
    if (g.isPublic && seenNames.has(key)) continue; // superseded by server copy
    const isDealThread = (g.keywords || []).includes('deal-thread');
    const isMine =
      g.creatorId === 'me' &&
      (!g.creatorEmail || !myEmail || g.creatorEmail === myEmail);
    const serverOrigin =
      g.creatorId === 'cloud' || g.creatorId === 'admin' || /^g\d+$/.test(g.id);
    if (g.isPublic && !isDealThread && (serverOrigin || !isMine)) continue; // ghost: prune
    if (g.isPublic) {
      if (seenNames.has(key)) continue;
      seenNames.add(key);
    }
    seenIds.add(g.id);
    reconciled.push(g);
  }
  return reconciled;
}
