-- ═══════════════════════════════════════════════════════════════
-- Lexis AI — Guest IP rate limiting
-- Run this once in Supabase Dashboard → SQL Editor
--
-- Purpose: stops someone from bypassing the per-guest 5/day limit
-- by just clicking "Try without an account" repeatedly to get a
-- fresh anonymous user each time. This table caps total guest
-- traffic per IP address, on top of the per-account limit.
--
-- Only the edge function (using the service role key) can read or
-- write this table — RLS is enabled with NO policies, so it's
-- deny-by-default for the anon/authenticated client roles. The
-- service role bypasses RLS entirely, which is intentional here.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.guest_ip_limits (
  ip_hash       text primary key,   -- SHA-256 of the IP, never the raw address
  window_start  timestamptz not null default now(),
  request_count int not null default 0
);

alter table public.guest_ip_limits enable row level security;
-- Deliberately no policies — normal clients get zero access either way.
