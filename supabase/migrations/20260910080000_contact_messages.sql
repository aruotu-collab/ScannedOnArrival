create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,
  name text,
  message text not null,
  user_id uuid,
  ip text,
  country text,
  status text not null default 'open',
  reply_text text,
  replied_at timestamptz,
  replied_by text
);

create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_status_idx on public.contact_messages (status, created_at desc);
create index if not exists contact_messages_ip_idx on public.contact_messages (ip, created_at desc);

alter table public.contact_messages enable row level security;
