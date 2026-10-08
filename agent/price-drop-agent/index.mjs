/**
 * index.mjs — price-drop intelligence agent.
 *
 * Every run:
 *   1. Pull recent group-chat comments.
 *   2. Detect price-drop signals (detect.mjs).
 *   3. Store new signals (dedupe on source comment).
 *   4. For each active user: match signals against their last-90-day
 *      purchases (match.mjs) + their watchlist.
 *   5. Insert notifications (DB unique index prevents double-notify).
 *
 * Run:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node index.mjs
 * Test: node test.mjs   (no DB needed)
 */
import { detectInComments } from './detect.mjs';
import { matchSignalsToPurchases, matchSignalsToWatchlist } from './match.mjs';
import { db } from './supabase.mjs';

const LOOKBACK_HOURS = Number(process.env.LOOKBACK_HOURS || 6);

async function main() {
  console.log(`[agent] scanning last ${LOOKBACK_HOURS}h of group chat…`);
  const comments = await db.recentComments(LOOKBACK_HOURS);
  console.log(`[agent] ${comments.length} comments fetched`);

  const signals = detectInComments(comments);
  console.log(`[agent] ${signals.length} price-drop signals detected`);

  if (signals.length === 0) {
    console.log('[agent] nothing to do.');
    return;
  }

  // Persist signals; rows that already exist (same source comment) are skipped
  // by the unique constraint — merge-duplicates keeps the first.
  let stored = [];
  try {
    stored = await db.upsertSignals(signals);
  } catch (e) {
    console.warn('[agent] signal upsert warning:', String(e).slice(0, 200));
  }
  console.log(`[agent] ${stored.length} new signals stored`);

  const userIds = await db.activeUsers();
  console.log(`[agent] matching against ${userIds.length} active users`);

  let notified = 0;
  for (const userId of userIds) {
    const [purchases, watchlist] = await Promise.all([
      db.userPurchases(userId),
      db.userWatchlist(userId),
    ]);
    const alerts = [
      ...matchSignalsToPurchases(signals, purchases),
      ...matchSignalsToWatchlist(signals, watchlist),
    ];
    if (alerts.length === 0) continue;
    const inserted = await db.insertNotifications(userId, alerts);
    notified += inserted.length;
    if (inserted.length) {
      console.log(`[agent] user ${userId.slice(0, 8)}…: ${inserted.length} alert(s)`);
    }
  }
  console.log(`[agent] done. ${notified} notification(s) created.`);
}

main().catch((e) => {
  console.error('[agent] FATAL:', e.message);
  process.exit(1);
});
