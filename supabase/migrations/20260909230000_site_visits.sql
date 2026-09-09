create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  ip text not null,
  path text not null,
  title text,
  referrer text,
  country text,
  user_agent text,
  user_id uuid,
  email text
);

create index if not exists site_visits_created_idx on public.site_visits (created_at desc);
create index if not exists site_visits_ip_idx on public.site_visits (ip, created_at desc);
create index if not exists site_visits_email_idx on public.site_visits (email, created_at desc);

alter table public.site_visits enable row level security;
