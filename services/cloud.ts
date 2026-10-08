/**
 * cloud.ts — Supabase backend integration for C-Shopper.
 *
 * Design: the app keeps working 100% offline-first (localStorage remains the
 * local cache and the source of truth for the UI). When the Supabase env vars
 * are present, this module syncs local data UP in the background and pulls
 * agent-generated price-drop notifications DOWN. Every function is defensive:
 * if the cloud is unreachable or unconfigured, the app behaves exactly as
 * before — no crashes, no blocking.
 *
 * Env (Vite): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  ReceiptItem, GlobalPriceEntry, CommunityGroup, GroupComment, ItemReview,
} from '../types';

let client: SupabaseClient | null = null;
let triedInit = false;

export function isCloudEnabled(): boolean {
  return !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;
}

function getClient(): SupabaseClient | null {
  if (!isCloudEnabled()) return null;
  if (!triedInit) {
    triedInit = true;
    try {
      client = createClient(
        import.meta.env.VITE_SUPABASE_URL as string,
        import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      );
    } catch (e) {
      console.warn('[cloud] failed to init Supabase client', e);
      client = null;
    }
  }
  return client;
}

/** Stable anonymous device identity until real auth lands. */
export function getCloudUserId(): string {
  const KEY = 'ws_cloud_user_id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) as string;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

async function ensureProfile(sb: SupabaseClient, userId: string, userName: string) {
  try {
    await sb.from('profiles').upsert(
      { id: userId, user_name: userName || 'Shopper' },
      { onConflict: 'id' },
    );
  } catch (e) {
    console.warn('[cloud] ensureProfile', e);
  }
}

export interface CloudNotification {
  id: string;
  title: string;
  body: string;
  kind: string;
  item_number: string | null;
  old_price: number | null;
  new_price: number | null;
  savings: number | null;
  is_read: boolean;
  created_at: string;
}

/** Pull unread + recent notifications written by the price-drop agent. */
export async function fetchCloudNotifications(): Promise<CloudNotification[]> {
  const sb = getClient();
  if (!sb) return [];
  try {
    const userId = getCloudUserId();
    const { data, error } = await sb
      .from('notifications')
      .select('id,title,body,kind,item_number,old_price,new_price,savings,is_read,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) throw error;
    return (data || []) as CloudNotification[];
  } catch (e) {
    console.warn('[cloud] fetchCloudNotifications', e);
    return [];
  }
}

export async function markCloudNotificationRead(id: string): Promise<void> {
  const sb = getClient();
  if (!sb) return;
  try {
    await sb.from('notifications').update({ is_read: true }).eq('id', id);
  } catch (e) {
    console.warn('[cloud] markCloudNotificationRead', e);
  }
}

/** Pull the user's home Costco (profiles.home_store_id). Null when unset. */
export async function fetchHomeStoreId(): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  try {
    const userId = getCloudUserId();
    const { data, error } = await sb
      .from('profiles')
      .select('home_store_id')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    return (data as { home_store_id: string | null } | null)?.home_store_id ?? null;
  } catch (e) {
    console.warn('[cloud] fetchHomeStoreId', e);
    return null;
  }
}

/** Persist the user's home Costco to their profile. Fire-and-forget safe. */
export async function saveHomeStoreId(storeId: string): Promise<void> {
  const sb = getClient();
  if (!sb) return;
  try {
    const userId = getCloudUserId();
    await ensureProfile(sb, userId, 'Shopper');
    const { error } = await sb
      .from('profiles')
      .update({ home_store_id: storeId })
      .eq('id', userId);
    if (error) throw error;
  } catch (e) {
    console.warn('[cloud] saveHomeStoreId', e);
  }
}

export interface PriceHistoryPoint {
  price: number;
  store_id: string | null;
  observed_at: string;
}

/** Recent community price observations for an item (optionally one store). */
export async function fetchPriceHistory(itemNumber: string, storeId?: string): Promise<PriceHistoryPoint[]> {
  const sb = getClient();
  if (!sb) return [];
  try {
    let q = sb
      .from('price_history')
      .select('price,store_id,observed_at')
      .eq('item_number', itemNumber)
      .order('observed_at', { ascending: false })
      .limit(20);
    if (storeId) q = q.eq('store_id', storeId);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []) as PriceHistoryPoint[];
  } catch (e) {
    console.warn('[cloud] fetchPriceHistory', e);
    return [];
  }
}

export interface StoreCatalogRow {
  item_number: string;
  item_name: string | null;
  category: string | null;
  store_id: string;
  store_name: string | null;
  price: number;
  unit_price: number | null;
  unit: string | null;
  observed_at: string;
}

/** Community-shared catalog for one store via the latest_prices view. */
export async function fetchStoreCatalog(storeId: string, limit = 300): Promise<StoreCatalogRow[]> {
  const sb = getClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('latest_prices')
      .select('item_number,item_name,category,store_id,store_name,price,unit_price,unit,observed_at')
      .eq('store_id', storeId)
      .limit(limit);
    if (error) throw error;
    return (data || []) as StoreCatalogRow[];
  } catch (e) {
    console.warn('[cloud] fetchStoreCatalog', e);
    return [];
  }
}

export interface CloudGroup {
  id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  store_id: string | null;
  keywords: string[] | null;
  created_at: string;
}

export interface CloudGroupComment {
  id: string;
  group_id: string;
  user_id: string;
  text: string;
  type: string | null;
  item_number: string | null;
  image_url: string | null;
  created_at: string;
  author_name?: string;
}

/**
 * Download public community groups so groups created on OTHER devices show
 * up here. Private groups stay local-only (no cross-device private sharing
 * yet — invites are a roadmap item).
 */
export async function fetchPublicGroups(limit = 100): Promise<CloudGroup[]> {
  const sb = getClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('community_groups')
      .select('id,name,description,is_public,store_id,keywords,created_at')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []) as CloudGroup[];
  } catch (e) {
    console.warn('[cloud] fetchPublicGroups', e);
    return [];
  }
}

/** Download chat messages for the given groups, with author names resolved. */
export async function fetchGroupComments(groupIds: string[], limit = 500): Promise<CloudGroupComment[]> {
  const sb = getClient();
  if (!sb || !groupIds.length) return [];
  try {
    const { data, error } = await sb
      .from('group_comments')
      .select('id,group_id,user_id,text,type,item_number,image_url,created_at')
      .in('group_id', groupIds)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    const rows = (data || []) as CloudGroupComment[];
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    if (userIds.length) {
      try {
        const { data: profs } = await sb.from('profiles').select('id,user_name').in('id', userIds);
        const nameOf = new Map<string, string>((profs || []).map((p: any) => [p.id as string, p.user_name as string]));
        for (const r of rows) r.author_name = nameOf.get(r.user_id) || 'Shopper';
      } catch { /* names fall back to 'Shopper' */ }
    }
    return rows;
  } catch (e) {
    console.warn('[cloud] fetchGroupComments', e);
    return [];
  }
}

export interface DealSignal {
  id: string;
  item_number: string;
  item_name: string;
  old_price: number | null; // null = clearance find (.97) with no price history
  new_price: number;
  store_id: string;
  detected_at: string;
}

/** Costco price-code lore: a price ending in .97 = unadvertised clearance. */
export function isClearancePrice(price: number): boolean {
  return Math.abs((price % 1) - 0.97) < 0.005;
}

/** Derive the signal kind from its prices — no extra column needed. */
export function signalDirection(s: DealSignal): 'drop' | 'rise' | 'clearance' {
  if (s.old_price == null) return 'clearance';
  return s.new_price < s.old_price ? 'drop' : 'rise';
}

/**
 * Compare freshly shared prices against the community's latest prices for
 * the store. Three signal kinds:
 *   1. Price drops: new price >=5% below the community's latest.
 *   2. Price rises: new price >=5% above the community's latest — worth
 *      knowing before you buy, and it keeps the history honest.
 *   3. Clearance finds: any shared price ending in .97 (the Costco97
 *      mechanic, automated) — even with no price history.
 * Dedupe: one signal per item+store per 7 days. Runs at share time, BEFORE
 * the debounced sync writes the new price_history rows, so latest_prices
 * still holds the previous price.
 */
export async function detectDealSignals(
  items: { itemNumber: string; name: string; price: number }[],
  storeId: string,
): Promise<DealSignal[]> {
  const sb = getClient();
  if (!sb || !items.length || !storeId) return [];
  try {
    const nums = [...new Set(items.map((i) => i.itemNumber))];
    const { data: prev } = await sb
      .from('latest_prices')
      .select('item_number,price')
      .eq('store_id', storeId)
      .in('item_number', nums);
    const prevMap = new Map<string, number>(
      (prev || []).map((r: any) => [r.item_number as string, Number(r.price)]),
    );
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data: recent } = await sb
      .from('price_drop_signals')
      .select('item_number')
      .eq('store_id', storeId)
      .in('item_number', nums)
      .gt('detected_at', weekAgo);
    const recentSet = new Set((recent || []).map((r: any) => r.item_number as string));
    const push = async (it: { itemNumber: string; name: string; price: number }, old: number | null, confidence: number) => {
      const { data, error } = await sb
        .from('price_drop_signals')
        .insert({
          item_number: it.itemNumber,
          item_name: it.name,
          old_price: old,
          new_price: it.price,
          store_id: storeId,
          confidence,
        })
        .select('id,item_number,item_name,old_price,new_price,store_id,detected_at');
      if (error) throw error;
      if (data && data[0]) {
        const s = data[0] as any;
        signals.push({
          id: s.id,
          item_number: s.item_number,
          item_name: s.item_name,
          old_price: s.old_price != null ? Number(s.old_price) : null,
          new_price: Number(s.new_price),
          store_id: s.store_id,
          detected_at: s.detected_at,
        });
      }
    };
    const signals: DealSignal[] = [];
    for (const it of items) {
      if (recentSet.has(it.itemNumber)) continue;
      const old = prevMap.get(it.itemNumber);
      if (old != null && old > 0 && it.price < old * 0.95) {
        await push(it, old, 0.9); // real price drop (was/now beats a plain .97 flag)
      } else if (old != null && old > 0 && it.price > old * 1.05) {
        await push(it, old, 0.85); // price rise — track it too
      } else if (isClearancePrice(it.price)) {
        await push(it, null, 0.7); // .97 clearance find
      }
    }
    return signals;
  } catch (e) {
    console.warn('[cloud] detectDealSignals', e);
    return [];
  }
}

/** Newest community price drops, for the Deals feed. */
export async function fetchDeals(limit = 50): Promise<DealSignal[]> {
  const sb = getClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('price_drop_signals')
      .select('id,item_number,item_name,old_price,new_price,store_id,detected_at')
      .order('detected_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data || []) as any[]).map((s) => ({
      id: s.id,
      item_number: s.item_number,
      item_name: s.item_name,
      old_price: s.old_price != null ? Number(s.old_price) : null,
      new_price: Number(s.new_price),
      store_id: s.store_id,
      detected_at: s.detected_at,
    }));
  } catch (e) {
    console.warn('[cloud] fetchDeals', e);
    return [];
  }
}

export interface DealAlertInput {
  item_number: string;
  item_name: string;
  old_price: number | null;
  new_price: number;
  store_id: string;
  store_name: string;
  kind: 'price_drop' | 'price_rise';
}

/**
 * Watchlist deal alerts: for each detected signal on an item the user
 * watches, write a persistent notification (the bell reads these). The
 * unique constraint (user_id, kind, item_number, new_price) dedupes
 * repeats. Drops include the 30-day price-adjustment tip — the money
 * feature; rises tell you before you buy.
 */
export async function publishDealAlerts(alerts: DealAlertInput[]): Promise<void> {
  const sb = getClient();
  if (!sb || !alerts.length) return;
  const userId = getCloudUserId();
  try {
    await sb.from('notifications').upsert(
      alerts.map((a) => {
        const isRise = a.kind === 'price_rise';
        return {
          user_id: userId,
          kind: a.kind,
          title: isRise ? `Price up: ${a.item_name}` : `Price drop: ${a.item_name}`,
          body: isRise
            ? `${a.item_name} rose to $${a.new_price.toFixed(2)} at ${a.store_name}` +
              (a.old_price != null ? ` (was $${a.old_price.toFixed(2)})` : ``) +
              `. Buy soon if you need it — or wait for it to come back down.`
            : `${a.item_name} is now $${a.new_price.toFixed(2)} at ${a.store_name}` +
              (a.old_price != null ? ` (was $${a.old_price.toFixed(2)})` : ` — unadvertised clearance`) +
              `. Bought it in the last 30 days? Ask the membership counter for a price adjustment.`,
          item_number: a.item_number,
          old_price: a.old_price,
          new_price: a.new_price,
          savings: a.old_price != null ? Math.round((a.old_price - a.new_price) * 100) / 100 : null,
        };
      }),
      { onConflict: 'user_id,kind,item_number,new_price' },
    );
  } catch (e) {
    console.warn('[cloud] publishDealAlerts', e);
  }
}

export interface FeedbackOutboxEntry {
  id: string;
  stars: number;
  category: string;
  body: string;
  app_version: string;
  created_at: string;
  synced: boolean;
}

/**
 * Flush locally-queued feedback (ws_feedback_outbox) to the `feedback`
 * table. No-op when the cloud is unconfigured or unreachable. Entries that
 * flush successfully are marked synced so they are not re-sent.
 */
export async function flushFeedbackOutbox(): Promise<void> {
  const sb = getClient();
  if (!sb) return;
  try {
    const raw = localStorage.getItem('ws_feedback_outbox');
    if (!raw) return;
    const entries = JSON.parse(raw) as FeedbackOutboxEntry[];
    const pending = entries.filter((e) => !e.synced);
    if (!pending.length) return;
    const userId = getCloudUserId();
    const { error } = await sb.from('feedback').insert(
      pending.map((e) => ({
        user_id: userId,
        stars: e.stars,
        category: e.category,
        body: e.body,
        app_version: e.app_version,
      })),
    );
    if (error) throw error;
    const pendingIds = new Set(pending.map((e) => e.id));
    localStorage.setItem(
      'ws_feedback_outbox',
      JSON.stringify(entries.map((e) => (pendingIds.has(e.id) ? { ...e, synced: true } : e))),
    );
  } catch (e) {
    // Flush must never break the app; unsynced entries retry next sync.
    console.warn('[cloud] flushFeedbackOutbox', e);
  }
}

export interface LocalSnapshot {
  receipts: ReceiptItem[];
  globalPrices: GlobalPriceEntry[];
  favorites: string[];
  groups: CommunityGroup[];
  groupComments: GroupComment[];
  itemReviews: ItemReview[];
  userName: string;
}

/**
 * Push local data to the cloud (fire-and-forget). Groups items into receipt
 * headers by purchase date, upserts everything with client_id dedupe keys so
 * repeated syncs never create duplicates.
 */
export async function syncUpToCloud(snap: LocalSnapshot): Promise<void> {
  const sb = getClient();
  if (!sb) return;
  const userId = getCloudUserId();
  try {
    await ensureProfile(sb, userId, snap.userName);

    // --- products + price history from the catalog ---
    if (snap.globalPrices.length) {
      const products = new Map<string, { item_number: string; name: string; category?: string }>();
      for (const p of snap.globalPrices) {
        if (!products.has(p.itemNumber)) {
          products.set(p.itemNumber, {
            item_number: p.itemNumber,
            name: p.itemName,
            category: p.category,
          });
        }
      }
      await sb.from('products').upsert([...products.values()], { onConflict: 'item_number' });
      // latest observation per item+store only, to keep history meaningful
      const latest = new Map<string, GlobalPriceEntry>();
      for (const p of snap.globalPrices) latest.set(`${p.itemNumber}|${p.warehouseId}`, p);
      await sb.from('price_history').insert(
        [...latest.values()].map((p) => ({
          item_number: p.itemNumber,
          store_id: p.warehouseId,
          price: p.price,
          unit_price: p.unitPrice ?? null,
          unit: p.unit ?? null,
          stock_status: p.stockStatus ?? null,
          is_discontinued: !!p.isDiscontinued,
          observed_at: p.updatedAt,
        })),
      );
    }

    // --- receipts: group flat items into headers by purchase date ---
    // PRIVACY: receipt items are PII-stripped on-device (services/moderation.ts
    // stripReceiptPII) at scan time, before they can be queued or synced.
    // Raw receipt text/images NEVER leave the device or reach this function.
    if (snap.receipts.length) {
      const byDate = new Map<string, ReceiptItem[]>();
      for (const r of snap.receipts) {
        const d = (r.purchaseDate || '').slice(0, 10) || 'unknown';
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d)!.push(r);
      }
      for (const [date, items] of byDate) {
        const clientId = `receipt-${date}`;
        const { data: rh } = await sb
          .from('receipts')
          .upsert(
            {
              user_id: userId,
              client_id: clientId,
              purchase_date: date === 'unknown' ? null : date,
              total: Math.round(items.reduce((a, b) => a + b.price, 0) * 100) / 100,
            },
            { onConflict: 'user_id,client_id' },
          )
          .select('id');
        const receiptId = rh && rh[0] ? (rh[0] as { id: string }).id : null;
        if (!receiptId) continue;
        await sb.from('receipt_items').upsert(
          items.map((r) => ({
            receipt_id: receiptId,
            user_id: userId,
            client_id: `item-${r.id}`,
            item_number: r.itemNumber,
            name: r.name,
            price: r.price,
            category: r.category,
            purchase_date: (r.purchaseDate || '').slice(0, 10) || null,
          })),
          { onConflict: 'user_id,client_id' },
        );
      }
    }

    // --- watchlist favorites ---
    // NOTE: favorites only carry item numbers, so resolve real names from the
    // price catalog / receipts first — never write the item number as the name.
    if (snap.favorites.length) {
      const nameOf = new Map<string, string>();
      for (const p of snap.globalPrices) {
        if (p.itemName && !nameOf.has(p.itemNumber)) nameOf.set(p.itemNumber, p.itemName);
      }
      for (const r of snap.receipts) {
        if (r.name && !nameOf.has(r.itemNumber)) nameOf.set(r.itemNumber, r.name);
      }
      const products = snap.favorites.map((n) => ({ item_number: n, name: nameOf.get(n) || n }));
      await sb.from('products').upsert(products, { onConflict: 'item_number' });
      await sb.from('watchlist').upsert(
        snap.favorites.map((n) => ({ user_id: userId, item_number: n })),
        { onConflict: 'user_id,item_number' },
      );
    }

    // --- community groups + comments ---
    for (const g of snap.groups) {
      await sb.from('community_groups').upsert(
        {
          id: /^[0-9a-f-]{36}$/i.test(g.id) ? g.id : undefined,
          name: g.name,
          description: g.description,
          creator_id: userId,
          is_public: g.isPublic,
          store_id: g.storeId ?? null,
          keywords: g.keywords,
        },
        { onConflict: 'id' },
      );
    }
    if (snap.groupComments.length) {
      // GroupComment has no explicit type in the app; flag likely price
      // mentions so the agent can prioritize them (it re-detects anyway).
      const guessType = (text: string) =>
        /\$\s?\d/.test(text) && /drop|deal|was|now|price|sale|clearance/i.test(text)
          ? 'price'
          : 'general';
      await sb.from('group_comments').upsert(
        snap.groupComments
          .filter((c) => /^[0-9a-f-]{36}$/i.test(c.id))
          .map((c) => ({
            id: c.id,
            group_id: /^[0-9a-f-]{36}$/i.test(c.groupId) ? c.groupId : null,
            user_id: userId,
            text: c.text,
            type: guessType(c.text),
            item_number: c.itemNumber ?? null,
            image_url: c.imageUrl ?? null,
          }))
          .filter((c) => c.group_id),
        { onConflict: 'id' },
      );
    }

    // --- item reviews ---
    if (snap.itemReviews.length) {
      await sb.from('item_reviews').upsert(
        snap.itemReviews
          .filter((r) => /^[0-9a-f-]{36}$/i.test(r.id))
          .map((r) => ({
            id: r.id,
            user_id: userId,
            store_id: r.warehouseId,
            item_number: r.itemNumber,
            item_name: r.itemName,
            rating: r.rating,
            text: r.text,
            image_url: r.imageUrl ?? null,
          })),
        { onConflict: 'id' },
      );
    }

    // --- feedback outbox: flush unsynced 1-5 star submissions ---
    await flushFeedbackOutbox();
  } catch (e) {
    // Sync must never break the app.
    console.warn('[cloud] syncUpToCloud', e);
  }
}
