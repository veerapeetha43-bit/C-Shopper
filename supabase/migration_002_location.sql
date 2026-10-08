-- ============================================================================
-- C-SHOPPER migration 002 — real location support
-- Run ONCE in the Supabase SQL editor AFTER migration_001 (schema.sql).
-- Then run supabase/seed_costco_us.sql to load the 605 US warehouses.
-- All statements are idempotent; safe to re-run.
-- ============================================================================

-- 1. Real geo columns on stores
alter table stores add column if not exists latitude  numeric;
alter table stores add column if not exists longitude numeric;
alter table stores add column if not exists phone     text;

-- 2. User's home Costco
alter table profiles add column if not exists home_store_id text
  references stores(id) on delete set null;

-- 3. Store-scoped public groups (NULL = general, not store-specific)
alter table community_groups add column if not exists store_id text
  references stores(id) on delete set null;
create index if not exists idx_groups_store on community_groups (store_id);

-- 4. Drop the 3 placeholder test warehouses (no real user data exists yet).
--    The full 605-store seed (seed_costco_us.sql) replaces them.
delete from stores where id in ('1','2','3');

-- NOTE: Row Level Security policies are table-level ("v1 open access"),
-- so the new columns are covered automatically. No policy changes needed.
