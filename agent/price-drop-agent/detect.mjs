/**
 * detect.mjs — extract price-drop signals from group chat messages.
 *
 * Pure functions, no I/O: safe to unit test with `node test.mjs`.
 *
 * A "signal" is: { itemNumber?, itemName?, oldPrice?, newPrice, storeHint?,
 *                  confidence, sourceText }
 */

const PRICE_RE = /\$\s?(\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?)/g;
// Costco-style item numbers: 5-7 digits, often written #123456 / item 123456
const ITEM_RE = /(?:#|item\s*(?:no\.?|number|#)?\s*)(\d{5,7})\b/i;

const DROP_KEYWORDS = [
  'price drop', 'pricedrop', 'price cut', 'pricecut', 'markdown', 'mark down',
  'dropped', 'reduced', 'clearance', 'deal', 'steal', 'rollback',
];

const WAS_NOW_RE =
  /was\s*\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:now|->|→|to)\s*\$\s?(\d[\d,]*(?:\.\d{1,2})?)/i;
const NOW_PRICE_RE =
  /(?:now|only|just)\s*\$\s?(\d[\d,]*(?:\.\d{1,2})?)/i;

function parseMoney(s) {
  return parseFloat(String(s).replace(/,/g, ''));
}

/** crude item-name guess: longest alpha phrase near the price mention */
function guessItemName(text) {
  const cleaned = text
    .replace(ITEM_RE, ' ')
    .replace(PRICE_RE, ' ')
    .replace(/[^a-zA-Z0-9\s'&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const stop = new Set([
    'was', 'now', 'only', 'just', 'the', 'and', 'for', 'at', 'costco',
    'price', 'drop', 'deal', 'today', 'yesterday', 'store', 'warehouse',
  ]);
  const words = cleaned.split(' ').filter((w) => w.length > 2 && !stop.has(w.toLowerCase()));
  return words.slice(0, 5).join(' ') || null;
}

export function detectPriceDrops(text) {
  if (!text || typeof text !== 'string') return [];
  const lower = text.toLowerCase();
  const signals = [];

  const itemMatch = text.match(ITEM_RE);
  const itemNumber = itemMatch ? itemMatch[1] : null;

  // Pattern 1: explicit "was $X now $Y" — highest confidence
  const wasNow = text.match(WAS_NOW_RE);
  if (wasNow) {
    const oldPrice = parseMoney(wasNow[1]);
    const newPrice = parseMoney(wasNow[2]);
    if (newPrice < oldPrice) {
      signals.push({
        itemNumber,
        itemName: guessItemName(text),
        oldPrice,
        newPrice,
        confidence: itemNumber ? 0.95 : 0.75,
        pattern: 'was_now',
      });
    }
    return signals; // was/now is decisive; don't double-count
  }

  // Pattern 2: drop keyword + a price ("price drop ... $12.99")
  const hasKeyword = DROP_KEYWORDS.some((k) => lower.includes(k));
  const prices = [...text.matchAll(PRICE_RE)].map((m) => parseMoney(m[1]));
  if (hasKeyword && prices.length > 0) {
    const newPrice = Math.min(...prices);
    const oldPrice = prices.length > 1 ? Math.max(...prices) : null;
    signals.push({
      itemNumber,
      itemName: guessItemName(text),
      oldPrice,
      newPrice,
      confidence: itemNumber ? 0.8 : 0.6,
      pattern: 'keyword',
    });
    return signals;
  }

  // Pattern 3: "now $X" / "only $X" phrasing
  const nowOnly = text.match(NOW_PRICE_RE);
  if (nowOnly && (hasKeyword || /deal|drop|sale/i.test(text))) {
    signals.push({
      itemNumber,
      itemName: guessItemName(text),
      oldPrice: null,
      newPrice: parseMoney(nowOnly[1]),
      confidence: itemNumber ? 0.65 : 0.5,
      pattern: 'now_only',
    });
  }

  return signals;
}

/** Run detection over a batch of comments; returns signals with source ids. */
export function detectInComments(comments) {
  const out = [];
  for (const c of comments) {
    for (const s of detectPriceDrops(c.text || '')) {
      out.push({ ...s, sourceCommentId: c.id, storeHint: c.storeHint || null });
    }
  }
  return out;
}
