# C-Shopper Cloud Setup

The app now has a real cloud backend design: **Supabase (Postgres)** for the
database, a **price-drop intelligence agent** that watches group chat and
notifies users, and **Vercel** for hosting. This guide covers the pieces that
need your action — everything else is already built.

## What was built

| Piece | Location | Status |
|---|---|---|
| Postgres schema (14 tables, RLS, seed data) | `supabase/schema.sql` | ✅ Ready to run |
| App ↔ Supabase sync layer (offline-first, localStorage stays as cache) | `services/cloud.ts` | ✅ Built, verified |
| Price-drop alert bell in the nav | `App.tsx` | ✅ Built, verified |
| Price-drop intelligence agent (19/19 tests pass) | `~/workspace/c-shopper/agent/price-drop-agent/` | ✅ Built, tested |
| Receipt CSV export | Dashboard → Recent Activity | ✅ Built |
| PWA manifest + icons (installable) | `public/` | ✅ Built |

**Your killer feature is implemented:** when someone in group chat posts
*"Kirkland paper towels #123456 was $24.99 now $19.99"*, the agent checks
every user's last 90 days of receipts. If you paid $24.99 in that window,
you get a notification: *"You paid $24.99 on Aug 15 — it's now $19.99.
That's $5.00 you could save next time."* Watchlist target-price hits are
covered too.

## What I need from you (3 things)

### 1. Create the Supabase project (free, ~3 minutes)
1. Go to https://supabase.com → sign up → **New project**.
2. Open the **SQL Editor**, paste the entire contents of
   `supabase/schema.sql`, and run it. You should see the tables +
   3 seeded warehouses + 2 starter groups.
3. Go to **Project Settings → API** and copy:
   - Project URL (`https://xyz.supabase.co`)
   - `anon` public key
   - `service_role` secret key

### 2. Give me the keys (secure)
Send me the three values through the secure credential card I'll provide —
they go straight to encrypted storage, I never see them in chat. I need:
- URL + anon key → baked into the app's Vercel deployment
- service_role key → used only by the price-drop agent on a schedule

### 3. Your local SQL files (optional but recommended)
Upload the files from `C:\Users\Admin\Documents\CShopperDB`. I'll inspect
the schema and migrate any existing data (products, prices, users) into the
cloud database so nothing is lost.

## What happens after you send the keys

1. I deploy the frontend to Vercel with the Supabase URL/anon key → you get
   a permanent public link.
2. I arm the price-drop agent on a schedule (every few hours) with the
   service_role key → group chat starts being watched automatically.
3. Your app instances sync receipts/prices/watchlist/community to the cloud
   in the background; alerts appear in the 🔔 bell in the nav.

## Still needs your keys later (not blocking)

- **Gemini API key** (`GEMINI_API_KEY`) — receipt photo scanning stays
  disabled until this is set. Get one at https://aistudio.google.com.
- **Stripe keys** — the Pricing page is still local pretend-state; real
  billing needs Stripe publishable + secret keys.

## Notes & limits

- Until real login (Supabase Auth) is wired, each device gets a stable
  anonymous ID — data syncs per device, not per person. Multi-device login
  for one account comes with the auth step.
- Row Level Security is on with permissive v1 policies (documented in
  `schema.sql`); tighten them when auth lands — the replacement policies
  are already written as comments at the bottom of the file.
- The agent only notifies on savings ≥ $1 and ≥ 3% to avoid spam, and never
  notifies twice about the same item + price.
