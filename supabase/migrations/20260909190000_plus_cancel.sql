alter table public.plus_subscribers
  add column if not exists cancel_at_period_end boolean not null default false;
