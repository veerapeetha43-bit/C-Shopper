# Price-Drop Intelligence Agent

Watches the C-Shopper community group chat for price-drop discussions, then
checks each user's last 90 days of purchases: if they bought the same item at
a higher price and it's now cheaper, they get a notification in the app.

## How it works

```
group_comments  →  detect.mjs  →  price_drop_signals  →  match.mjs  →  notifications
   (chat)         (was $X now $Y,                    (vs last-90-day
                   #itemnumber, deal                 receipt_items +
                   keywords)                         watchlist)
```

- **detect.mjs** — pure functions. Finds patterns like `was $24.99 now $19.99`,
  `PRICE DROP ... $12.99`, `item #123456 now $8.49`. Returns item number (when
  present), guessed item name, old/new price, confidence.
- **match.mjs** — pure functions. Exact item-number match first, fuzzy
  name-token fallback second. Ignores savings under $1 or 3% (noise guard).
  Also matches the user's watchlist against target prices.
- **supabase.mjs** — thin Supabase REST client (plain `fetch`, zero deps).
  Uses the **service_role** key (bypasses RLS) — agent-only, never shipped
  to browsers.
- **index.mjs** — the run loop: fetch recent comments → detect → store new
  signals → per-user matching → insert notifications. The DB unique index on
  `(user_id, kind, item_number, new_price)` is the dedupe guard: nobody gets
  notified twice about the same drop.

## Run it

```bash
SUPABASE_URL=https://xyz.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
LOOKBACK_HOURS=6 \
node index.mjs
```

## Test it (no database needed)

```bash
node test.mjs   # 19 unit tests for detection + matching
```

## Scheduling

Intended to run every few hours via a cron job. Each run is idempotent:
re-running the same window only inserts genuinely new signals/notifications.
