/**
 * match.mjs — match price-drop signals against a user's purchase history.
 *
 * Pure functions, no I/O. The agent feeds them:
 *   signals  — from detect.mjs (itemNumber/itemName + newPrice)
 *   purchases — the user's receipt_items from the last 90 days:
 *               [{ item_number, name, price, purchase_date }]
 *   watchlist — [{ item_number, target_price? }]
 *
 * Returns alert objects ready to insert into `notifications`:
 *   { kind, title, body, item_number, old_price, new_price, savings }
 */

const MS_PER_DAY = 86400000;
const WINDOW_DAYS = 90;
const MIN_SAVINGS_ABS = 1.0; // ignore sub-$1 noise
const MIN_SAVINGS_PCT = 0.03; // ...or sub-3% noise

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** token-overlap similarity 0..1 */
function nameSimilarity(a, b) {
  const ta = new Set(normalizeName(a).split(' ').filter((w) => w.length > 2));
  const tb = new Set(normalizeName(b).split(' ').filter((w) => w.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

function withinWindow(purchaseDate, now = new Date()) {
  const d = new Date(purchaseDate).getTime();
  if (Number.isNaN(d)) return false;
  return now.getTime() - d <= WINDOW_DAYS * MS_PER_DAY && d <= now.getTime();
}

function worthAlerting(paidPrice, newPrice) {
  const savings = paidPrice - newPrice;
  if (savings < MIN_SAVINGS_ABS) return 0;
  if (savings / paidPrice < MIN_SAVINGS_PCT) return 0;
  return Math.round(savings * 100) / 100;
}

function fmt(n) {
  return `$${Number(n).toFixed(2)}`;
}

/**
 * Core feature the user asked for:
 * "scan items suggested from the group chat where users discuss price drops,
 *  find in my last 3 months if I have that item purchased for a higher price
 *  and now it costs less -> notify me."
 */
export function matchSignalsToPurchases(signals, purchases, now = new Date()) {
  const alerts = [];
  const recent = purchases.filter((p) => withinWindow(p.purchase_date, now));

  for (const s of signals) {
    // 1) exact item-number match (most reliable)
    let candidates = s.itemNumber
      ? recent.filter((p) => String(p.item_number) === String(s.itemNumber))
      : [];
    // 2) fallback: fuzzy name match when the chat didn't include an item #
    if (candidates.length === 0 && s.itemName) {
      candidates = recent.filter((p) => nameSimilarity(p.name, s.itemName) >= 0.6);
    }
    if (candidates.length === 0) continue;

    // use the highest price they paid in-window (worst overpayment)
    const worst = candidates.reduce((a, b) => (a.price >= b.price ? a : b));
    const savings = worthAlerting(Number(worst.price), Number(s.newPrice));
    if (!savings) continue;

    const dateStr = new Date(worst.purchase_date).toLocaleDateString('en-US');
    alerts.push({
      kind: 'price_drop',
      title: 'Price drop on something you bought',
      body:
        `You paid ${fmt(worst.price)} for "${worst.name}" on ${dateStr}. ` +
        `It's now ${fmt(s.newPrice)}${s.storeHint ? ` at ${s.storeHint}` : ''} — ` +
        `that's ${fmt(savings)} you could save next time.`,
      item_number: String(worst.item_number),
      old_price: Number(worst.price),
      new_price: Number(s.newPrice),
      savings,
      dedupeKey: `${worst.item_number}:${s.newPrice}`,
    });
  }
  return alerts;
}

/** Watchlist variant: alert when a discussed price hits the user's target. */
export function matchSignalsToWatchlist(signals, watchlist) {
  const alerts = [];
  for (const s of signals) {
    if (!s.itemNumber) continue;
    const entry = watchlist.find((w) => String(w.item_number) === String(s.itemNumber));
    if (!entry) continue;
    const target = entry.target_price;
    if (target != null && Number(s.newPrice) > Number(target)) continue;
    alerts.push({
      kind: 'watchlist',
      title: 'Watchlist price hit',
      body:
        `An item on your watchlist${s.itemName ? ` ("${s.itemName}")` : ''} ` +
        `was spotted at ${fmt(s.newPrice)}${target != null ? ` (your target: ${fmt(target)})` : ''}.`,
      item_number: String(s.itemNumber),
      old_price: s.oldPrice != null ? Number(s.oldPrice) : null,
      new_price: Number(s.newPrice),
      savings: null,
      dedupeKey: `${s.itemNumber}:${s.newPrice}`,
    });
  }
  return alerts;
}
