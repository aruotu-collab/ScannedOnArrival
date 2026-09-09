create table if not exists public.plus_subscribers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'inactive',
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists plus_subscribers_customer_idx
  on public.plus_subscribers (stripe_customer_id);

alter table public.plus_subscribers enable row level security;

drop policy if exists "plus_subscribers_select_own" on public.plus_subscribers;
create policy "plus_subscribers_select_own"
  on public.plus_subscribers for select
  using (user_id = auth.uid() or user_id = public.my_household_id());

create or replace function public.plus_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.plus_subscribers
    where user_id = coalesce(public.my_household_id(), auth.uid())
      and status in ('active', 'trialing')
  );
$$;

grant select on public.plus_subscribers to authenticated;
grant execute on function public.plus_active() to authenticated;
