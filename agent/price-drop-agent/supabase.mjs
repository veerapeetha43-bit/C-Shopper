/**
 * supabase.mjs — minimal Supabase REST client over plain fetch (no deps).
 * Uses the service_role key, which bypasses RLS: agent-only, never in the app.
 */

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function checkEnv() {
  if (!URL || !KEY) {
    throw new Error(
      'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.'
    );
  }
}

async function req(path, { method = 'GET', body, params = {} } = {}) {
  checkEnv();
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${URL}/rest/v1/${path}${qs ? `?${qs}` : ''}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${t.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

export const db = {
  /** comments from the last `hours`H, newest last */
  recentComments: (hours = 6) =>
    req('group_comments', {
      params: {
        select: 'id,group_id,text,type,item_number,created_at',
        created_at: `gte.${new Date(Date.now() - hours * 3600e3).toISOString()}`,
        order: 'created_at.asc',
        limit: '500',
      },
    }),

  upsertSignals: (signals) =>
    signals.length
      ? req('price_drop_signals', {
          method: 'POST',
          body: signals.map((s) => ({
            item_number: s.itemNumber || null,
            item_name: s.itemName || null,
            old_price: s.oldPrice ?? null,
            new_price: s.newPrice,
            store_id: s.storeId || null,
            source_comment_id: s.sourceCommentId,
            confidence: s.confidence,
          })),
        })
      : [],

  /** all users who have any purchase in the last 90 days */
  activeUsers: () =>
    req('receipt_items', {
      params: {
        select: 'user_id',
        purchase_date: `gte.${new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10)}`,
        limit: '5000',
      },
    }).then((rows) => [...new Set(rows.map((r) => r.user_id))]),

  userPurchases: (userId) =>
    req('receipt_items', {
      params: {
        select: 'item_number,name,price,purchase_date',
        user_id: `eq.${userId}`,
        purchase_date: `gte.${new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10)}`,
        order: 'purchase_date.desc',
        limit: '5000',
      },
    }),

  userWatchlist: (userId) =>
    req('watchlist', { params: { select: 'item_number,target_price', user_id: `eq.${userId}` } }),

  /** insert alerts; the unique(user_id,kind,item_number,new_price) index dedupes */
  insertNotifications: (userId, alerts) =>
    alerts.length
      ? req('notifications', {
          method: 'POST',
          body: alerts.map((a) => ({
            user_id: userId,
            kind: a.kind,
            title: a.title,
            body: a.body,
            item_number: a.item_number,
            old_price: a.old_price,
            new_price: a.new_price,
            savings: a.savings,
          })),
        }).catch((e) => {
          // 409/unique-violation just means "already notified" — not fatal
          if (/duplicate|unique|409/i.test(String(e))) return [];
          throw e;
        })
      : [],
};
