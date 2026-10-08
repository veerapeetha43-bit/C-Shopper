-- ============================================================================
-- C-SHOPPER cloud database schema (PostgreSQL / Supabase)
-- ============================================================================
-- How to use:
--   1. Create a free project at https://supabase.com (or any hosted Postgres).
--   2. Open the SQL editor and run this entire file once.
--   3. Done. The app connects with the project's URL + anon key;
--      the price-drop agent uses the service_role key.
--
-- Design notes:
--   * Mirrors the app's TypeScript types in types.ts (Store, ReceiptItem,
--     GlobalPriceEntry, CommunityGroup, GroupComment, ItemReview,
--     AppNotification, watchlist favorites).
--   * The app's local state keeps working offline (localStorage cache);
--     services/cloud.ts syncs it here in the background.
--   * Row Level Security is ON with permissive anon policies so the app
--     works before Supabase Auth is wired. Tighten the policies (see the
--     commented AUTHENTICATED section at the bottom) once real login lands.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Profiles & subscription (was: ws_logged_in + ws_sub in localStorage)
-- --------------------------------------------------------------------------
create table if not exists profiles (
  id            uuid primary key,
  user_name     text not null default 'Shopper',
  avatar_url    text,
  email_or_phone text,
  home_store_id text references stores(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists subscriptions (
  user_id        uuid primary key references profiles(id) on delete cascade,
  tier           text not null default 'silver'
                   check (tier in ('silver','gold','platinum')),
  status         text not null default 'trial'
                   check (status in ('active','cancelled','trial')),
  is_trial       boolean not null default true,
  trial_start    timestamptz not null default now(),
  receipts_count integer not null default 0,
  stripe_customer_id text,
  updated_at     timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- Stores & catalog (was: MOCK_STORES + ws_global_prices)
-- --------------------------------------------------------------------------
create table if not exists stores (
  id            text primary key,               -- 'us-<state>-NNNN', e.g. 'us-ca-0001'
  name          text not null,
  address       text,
  zip_code      text,
  latitude      numeric,
  longitude     numeric,
  phone         text,
  distance_mi   numeric,
  gas_regular   numeric,
  gas_premium   numeric,
  gas_updated_at timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists products (
  item_number text primary key,                -- Costco-style item number
  name        text not null,
  category    text,
  created_at  timestamptz not null default now()
);

-- Every observed price becomes a history row: this powers price charts,
-- "was $X now $Y" detection, and the 3-month overpayment check.
create table if not exists price_history (
  id              uuid primary key default gen_random_uuid(),
  item_number     text not null references products(item_number),
  store_id        text not null references stores(id),
  price           numeric not null check (price >= 0),
  unit_price      numeric,
  unit            text,
  stock_status    text check (stock_status in ('high','low','out_of_stock')),
  is_discontinued boolean not null default false,
  observed_at     timestamptz not null default now()
);
create index if not exists idx_price_history_item_time
  on price_history (item_number, observed_at desc);
create index if not exists idx_price_history_store
  on price_history (store_id, observed_at desc);

-- Convenience view: latest known price per item per store.
create or replace view latest_prices as
select distinct on (ph.item_number, ph.store_id)
  ph.item_number, p.name as item_name, p.category,
  ph.store_id, s.name as store_name,
  ph.price, ph.unit_price, ph.unit,
  ph.stock_status, ph.is_discontinued, ph.observed_at
from price_history ph
join products p on p.item_number = ph.item_number
join stores s on s.id = ph.store_id
order by ph.item_number, ph.store_id, ph.observed_at desc;

-- --------------------------------------------------------------------------
-- Receipts (was: ws_receipts flat ReceiptItem[] in localStorage)
-- --------------------------------------------------------------------------
create table if not exists receipts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  client_id      text not null,                 -- local dedupe key
  store_id       text references stores(id),
  warehouse_name text,
  zip_code       text,
  purchase_date  date,
  total          numeric,
  image_url      text,                          -- receipt photo (storage)
  created_at     timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists idx_receipts_user_date
  on receipts (user_id, purchase_date desc);

create table if not exists receipt_items (
  id           uuid primary key default gen_random_uuid(),
  receipt_id   uuid not null references receipts(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  client_id    text not null,                   -- local dedupe key
  item_number  text not null,
  name         text not null,
  price        numeric not null check (price >= 0),
  category     text,
  purchase_date date,
  created_at   timestamptz not null default now(),
  unique (user_id, client_id)
);
create index if not exists idx_receipt_items_user_item
  on receipt_items (user_id, item_number, purchase_date desc);
create index if not exists idx_receipt_items_item
  on receipt_items (item_number);

-- --------------------------------------------------------------------------
-- Watchlist (was: ws_favorites string[] of itemNumbers)
-- --------------------------------------------------------------------------
create table if not exists watchlist (
  user_id      uuid not null references profiles(id) on delete cascade,
  item_number  text not null references products(item_number),
  target_price numeric,                          -- alert at or below this
  created_at   timestamptz not null default now(),
  primary key (user_id, item_number)
);

-- --------------------------------------------------------------------------
-- Community (was: ws_groups + ws_group_comments)
-- --------------------------------------------------------------------------
create table if not exists community_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  creator_id  uuid references profiles(id) on delete set null,
  is_public   boolean not null default true,
  store_id    text references stores(id) on delete set null,  -- NULL = general
  keywords    text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists group_members (
  group_id uuid not null references community_groups(id) on delete cascade,
  user_id  uuid not null references profiles(id) on delete cascade,
  status   text not null default 'member'
             check (status in ('member','pending')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists group_comments (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references community_groups(id) on delete cascade,
  user_id     uuid references profiles(id) on delete set null,
  text        text not null,
  type        text not null default 'general'
                check (type in ('price','availability','review','general')),
  item_number text,                              -- linked catalog item, if any
  image_url   text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_group_comments_group_time
  on group_comments (group_id, created_at desc);
create index if not exists idx_group_comments_time
  on group_comments (created_at desc);

create table if not exists item_reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete set null,
  store_id    text references stores(id),
  item_number text not null,
  item_name   text,
  rating      int check (rating between 1 and 5),
  text        text,
  image_url   text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_item_reviews_item
  on item_reviews (item_number, created_at desc);

-- --------------------------------------------------------------------------
-- Price-drop intelligence (written by the agent, read by the app)
-- --------------------------------------------------------------------------
-- Raw signals the agent extracts from group chat ("was $X now $Y", item #..).
create table if not exists price_drop_signals (
  id                uuid primary key default gen_random_uuid(),
  item_number       text,
  item_name         text,
  old_price         numeric,
  new_price         numeric not null check (new_price >= 0),
  store_id          text references stores(id),
  source_comment_id uuid unique references group_comments(id) on delete set null,
  confidence        numeric not null default 0.5
                      check (confidence between 0 and 1),
  detected_at       timestamptz not null default now()
);
create index if not exists idx_signals_item_time
  on price_drop_signals (item_number, detected_at desc);

-- Per-user alerts. The unique constraint is the dedupe guard: the agent
-- never notifies the same user twice about the same item+price.
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        text not null default 'price_drop'
                check (kind in ('price_drop','price_rise','watchlist','info')),
  title       text not null,
  body        text not null,
  item_number text,
  old_price   numeric,
  new_price   numeric,
  savings     numeric,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, kind, item_number, new_price)
);
create index if not exists idx_notifications_user_time
  on notifications (user_id, created_at desc);

-- --------------------------------------------------------------------------
-- In-app feedback (1-5 star ratings; CTO triages by stars: 1* = urgent)
-- --------------------------------------------------------------------------
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  stars int not null check (stars between 1 and 5),
  category text not null,
  body text not null,
  app_version text,
  created_at timestamptz not null default now()
);
create index if not exists idx_feedback_stars_time
  on feedback (stars, created_at desc);

-- ============================================================================
-- Row Level Security: permissive for v1 (no auth wired yet).
-- The app's anon key can read/write; the agent's service_role key bypasses
-- RLS entirely. Tighten once Supabase Auth lands (see bottom).
-- ============================================================================
alter table profiles           enable row level security;
alter table subscriptions      enable row level security;
alter table stores             enable row level security;
alter table products           enable row level security;
alter table price_history      enable row level security;
alter table receipts           enable row level security;
alter table receipt_items      enable row level security;
alter table watchlist          enable row level security;
alter table community_groups   enable row level security;
alter table group_members      enable row level security;
alter table group_comments     enable row level security;
alter table item_reviews       enable row level security;
alter table price_drop_signals enable row level security;
alter table notifications      enable row level security;
alter table feedback           enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','subscriptions','stores','products','price_history',
    'receipts','receipt_items','watchlist','community_groups','group_members',
    'group_comments','item_reviews','price_drop_signals','notifications',
    'feedback']
  loop
    execute format(
      'drop policy if exists "v1 open access" on %I; '
      'create policy "v1 open access" on %I for all to anon, authenticated '
      'using (true) with check (true);', t, t);
  end loop;
end $$;

-- ============================================================================
-- Seed data: starter groups from the app's mock data.
-- Warehouse seed: the full 605-store US dataset lives in
-- supabase/seed_costco_us.sql — run it AFTER this file.
-- ============================================================================

insert into community_groups (id, name, description, is_public, keywords)
values
  ('00000000-0000-0000-0000-0000000000a1','Organic Finders',
   'Discuss organic item prices and quality.', true, '{organic,healthy,fresh}'),
  ('00000000-0000-0000-0000-0000000000a2','Tech Deals',
   'Electronics price drops and reviews.', true, '{tech,tv,laptop}')
on conflict (id) do nothing;

-- ============================================================================
-- WHEN SUPABASE AUTH LANDS: replace the "v1 open access" policies with
-- per-user policies, e.g.:
--
--   drop policy "v1 open access" on receipts;
--   create policy "own receipts" on receipts for all to authenticated
--     using (auth.uid() = user_id) with check (auth.uid() = user_id);
--   ... (same pattern for receipt_items, watchlist, notifications,
--        subscriptions, profiles) ...
--   create policy "public read" on stores        for select to anon, authenticated using (true);
--   create policy "public read" on products     for select to anon, authenticated using (true);
--   create policy "public read" on price_history for select to anon, authenticated using (true);
--   ... etc for community tables (insert: authenticated only).
-- ============================================================================
