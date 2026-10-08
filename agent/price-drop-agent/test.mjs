/** Unit tests for detect.mjs + match.mjs. Run: node test.mjs (no DB needed). */
import { detectPriceDrops, detectInComments } from './detect.mjs';
import { matchSignalsToPurchases, matchSignalsToWatchlist } from './match.mjs';

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; /* console.log(`  ok: ${name}`); */ }
  else { fail++; console.log(`FAIL ${name}\n  got:      ${a}\n  expected: ${e}`); }
}

// --- detection ---
let s = detectPriceDrops('Kirkland paper towels #123456 was $24.99 now $19.99 at Issaquah!!');
eq('was/now item#', s.length, 1);
eq('was/now number', s[0].itemNumber, '123456');
eq('was/now old', s[0].oldPrice, 24.99);
eq('was/now new', s[0].newPrice, 19.99);

s = detectPriceDrops('PRICE DROP: AirPods Pro only $149.99 today, insane deal');
eq('keyword deal', s.length, 1);
eq('keyword price', s[0].newPrice, 149.99);

s = detectPriceDrops('loved the hot dog combo today, so good');
eq('no false positive', s.length, 0);

s = detectPriceDrops('item 987654 now $8.49 (price cut)');
eq('item keyword form', s.length, 1);
eq('item keyword number', s[0].itemNumber, '987654');

const batch = detectInComments([
  { id: 'c1', text: 'was $30 now $22 on #555666 vitamins' },
  { id: 'c2', text: 'hello everyone' },
]);
eq('batch count', batch.length, 1);
eq('batch source id', batch[0].sourceCommentId, 'c1');

// --- matching ---
const now = new Date('2026-09-25T12:00:00Z');
const purchases = [
  { item_number: '123456', name: 'Kirkland Paper Towels 12pk', price: 24.99, purchase_date: '2026-08-15' },
  { item_number: '999', name: 'Bananas', price: 1.99, purchase_date: '2026-09-20' },
  { item_number: 'old', name: 'Ancient TV', price: 900, purchase_date: '2025-01-01' }, // outside window
];
const signals = [
  { itemNumber: '123456', itemName: 'paper towels', newPrice: 19.99, oldPrice: 24.99, confidence: 0.9 },
  { itemNumber: '999', newPrice: 1.89, confidence: 0.6 },   // savings too small
  { itemNumber: 'old', newPrice: 500, confidence: 0.9 },      // outside 90d window
  { itemNumber: 'nope', newPrice: 5, confidence: 0.9 },       // never bought
];
let alerts = matchSignalsToPurchases(signals, purchases, now);
eq('one real alert', alerts.length, 1);
eq('alert item', alerts[0].item_number, '123456');
eq('alert savings', alerts[0].savings, 5);
eq('alert kind', alerts[0].kind, 'price_drop');

// fuzzy name fallback (no item number in chat)
alerts = matchSignalsToPurchases(
  [{ itemNumber: null, itemName: 'Kirkland paper towels 12 pack', newPrice: 18.0, confidence: 0.6 }],
  purchases, now);
eq('fuzzy name match', alerts.length, 1);

// watchlist
const wl = matchSignalsToWatchlist(
  [{ itemNumber: '123456', itemName: 'towels', newPrice: 19.99, confidence: 0.9 }],
  [{ item_number: '123456', target_price: 21 }]);
eq('watchlist hit', wl.length, 1);
eq('watchlist kind', wl[0].kind, 'watchlist');

const wl2 = matchSignalsToWatchlist(
  [{ itemNumber: '123456', newPrice: 25.0, confidence: 0.9 }],
  [{ item_number: '123456', target_price: 21 }]);
eq('watchlist above target = silent', wl2.length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
