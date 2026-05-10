-- Run this in the Supabase SQL editor.
-- Read-only by design: nothing in this app deletes or modifies emails in Gmail.
-- The local copies stored here can be removed by you in Supabase if you ever
-- want to wipe the cache; the app itself never exposes a delete action.

create extension if not exists "pgcrypto";

-- Users authenticated via Google OAuth.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  google_id text unique not null,
  email text not null,
  name text,
  picture text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  created_at timestamptz default now()
);

-- A "sender group" represents one entity (a person OR a company)
-- whose correspondence you want to analyse. It can hold multiple
-- email addresses, e.g. all Highly Recruitment staff.
create table if not exists sender_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  description text,
  email_addresses text[] not null,
  last_synced_at timestamptz,
  created_at timestamptz default now()
);

-- One row per Gmail message we have cached.
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  sender_group_id uuid not null references sender_groups(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text not null,
  subject text,
  from_email text,
  from_name text,
  to_emails text[],
  cc_emails text[],
  sent_at timestamptz not null,
  body_text text,
  snippet text,
  -- "incoming" = from the group to you
  -- "outgoing" = from you to the group
  -- "other"    = neither (rare; e.g. cc'd third parties)
  direction text check (direction in ('incoming', 'outgoing', 'other')),
  ref_number int,
  created_at timestamptz default now(),
  unique (user_id, gmail_message_id)
);

-- PDF attachments only, per the POC scope.
create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  extracted_text text,
  created_at timestamptz default now()
);

create index if not exists idx_messages_group_sent
  on messages (sender_group_id, sent_at);

create index if not exists idx_attachments_message
  on attachments (message_id);

create index if not exists idx_sender_groups_user
  on sender_groups (user_id, created_at desc);
