-- ═══════════════════════════════════════════════════════════════
-- Lexis AI — Rate limiting table
-- Run this once in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.rate_limits (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  window_start  timestamptz not null default now(),
  request_count int not null default 0
);

alter table public.rate_limits enable row level security;

-- The edge function calls this table using the signed-in user's own
-- token, so it only ever touches that user's own row.
create policy "Users manage their own rate limit row"
  on public.rate_limits for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);
