-- ═══════════════════════════════════════════════════════════════
-- Lexis AI — Chat history tables
-- Run this once in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- One row per conversation shown in the sidebar
create table if not exists public.chats (
  id         text primary key,             -- keeps your existing 'chat_<timestamp>' ids
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default 'New Chat',
  created_at timestamptz not null default now()
);

-- One row per message inside a conversation
create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  chat_id    text not null references public.chats(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chats_user       on public.chats(user_id);
create index if not exists idx_messages_chat    on public.chat_messages(chat_id);
create index if not exists idx_messages_user    on public.chat_messages(user_id);

-- ── Row Level Security: every user can only ever see/edit their own rows ──
alter table public.chats         enable row level security;
alter table public.chat_messages enable row level security;

create policy "Users manage their own chats"
  on public.chats for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own messages"
  on public.chat_messages for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);
