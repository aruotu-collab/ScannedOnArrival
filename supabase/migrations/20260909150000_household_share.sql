create table if not exists public.household_members (
  household_id uuid not null references auth.users (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null default '',
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references auth.users (id) on delete cascade,
  code text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz
);

create index if not exists household_members_user_id_idx on public.household_members (user_id);
create index if not exists household_invites_code_idx on public.household_invites (code);

alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

create or replace function public.my_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id
  from public.household_members
  where user_id = auth.uid()
  limit 1;
$$;

create or replace function public.household_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  out text := '';
  i int;
begin
  for i in 1..6 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;

create or replace function public.household_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  hid uuid;
  my_role text;
begin
  if uid is null then
    return null;
  end if;

  select household_id, role into hid, my_role
  from public.household_members
  where user_id = uid
  limit 1;

  if hid is null then
    return jsonb_build_object(
      'householdId', uid,
      'role', 'solo',
      'members', '[]'::jsonb,
      'invite', null
    );
  end if;

  return jsonb_build_object(
    'householdId', hid,
    'role', case when hid = uid then 'owner' else coalesce(my_role, 'member') end,
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object('userId', user_id, 'email', email, 'role', role)
        order by role, email
      )
      from public.household_members
      where household_id = hid
    ), '[]'::jsonb),
    'invite', (
      select jsonb_build_object('code', code, 'expiresAt', expires_at)
      from public.household_invites
      where household_id = hid
        and redeemed_at is null
        and expires_at > now()
      order by created_at desc
      limit 1
    )
  );
end;
$$;

create or replace function public.create_household_invite()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  em text := coalesce(auth.jwt() ->> 'email', '');
  existing public.household_invites;
  hid uuid;
  other uuid;
  next_code text;
  attempts int := 0;
begin
  if uid is null then
    raise exception 'Sign in first';
  end if;

  select household_id into other
  from public.household_members
  where user_id = uid and household_id <> uid
  limit 1;
  if other is not null then
    raise exception 'Leave the other household before inviting someone to yours.';
  end if;

  hid := uid;
  insert into public.household_members (household_id, user_id, email, role)
  values (hid, uid, em, 'owner')
  on conflict (household_id, user_id) do update
    set email = excluded.email, role = 'owner';

  select * into existing
  from public.household_invites
  where household_id = hid
    and redeemed_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if existing.id is not null then
    return jsonb_build_object('code', existing.code, 'expiresAt', existing.expires_at);
  end if;

  loop
    attempts := attempts + 1;
    next_code := public.household_invite_code();
    begin
      insert into public.household_invites (household_id, code, created_by)
      values (hid, next_code, uid)
      returning * into existing;
      exit;
    exception when unique_violation then
      if attempts > 8 then
        raise exception 'Could not make an invite code.';
      end if;
    end;
  end loop;

  return jsonb_build_object('code', existing.code, 'expiresAt', existing.expires_at);
end;
$$;

create or replace function public.accept_household_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  em text := coalesce(auth.jwt() ->> 'email', '');
  invite public.household_invites;
  current_hid uuid;
begin
  if uid is null then
    raise exception 'Sign in first';
  end if;

  select * into invite
  from public.household_invites
  where upper(code) = upper(trim(invite_code))
    and redeemed_at is null
    and expires_at > now();

  if invite.id is null then
    raise exception 'That code is not valid, or it has expired.';
  end if;

  if invite.household_id = uid then
    raise exception 'That is your own invite code.';
  end if;

  select household_id into current_hid
  from public.household_members
  where user_id = uid
  limit 1;

  if current_hid is not null and current_hid = uid then
    if exists (
      select 1 from public.household_members
      where household_id = uid and user_id <> uid
    ) then
      raise exception 'Remove the other person before joining another household.';
    end if;
    delete from public.household_invites
    where household_id = uid and redeemed_at is null;
    delete from public.household_members
    where household_id = uid;
    current_hid := null;
  end if;

  if current_hid is not null and current_hid <> invite.household_id then
    raise exception 'Leave the other household first.';
  end if;

  insert into public.household_members (household_id, user_id, email, role)
  values (invite.household_id, uid, em, 'member')
  on conflict (household_id, user_id) do update
    set email = excluded.email;

  update public.household_invites
  set redeemed_by = uid, redeemed_at = now()
  where id = invite.id;

  return invite.household_id;
end;
$$;

create or replace function public.leave_household()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then
    raise exception 'Sign in first';
  end if;

  select household_id into hid
  from public.household_members
  where user_id = uid
  limit 1;

  if hid is null then
    return;
  end if;
  if hid = uid then
    raise exception 'Remove the other person instead of leaving your own household.';
  end if;

  delete from public.household_members
  where household_id = hid and user_id = uid;
end;
$$;

create or replace function public.remove_household_member(member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first';
  end if;
  if member_id is null or member_id = uid then
    raise exception 'You cannot remove yourself.';
  end if;

  delete from public.household_members
  where household_id = uid
    and user_id = member_id
    and role = 'member';

  if not found then
    raise exception 'That person is not in your household.';
  end if;
end;
$$;

drop policy if exists "household_members_select" on public.household_members;
drop policy if exists "household_invites_select_own" on public.household_invites;

create policy "household_members_select"
  on public.household_members for select
  using (user_id = auth.uid() or household_id = auth.uid() or household_id = public.my_household_id());

create policy "household_invites_select_own"
  on public.household_invites for select
  using (created_by = auth.uid() or household_id = auth.uid());

grant select on public.household_members to authenticated;
grant select on public.household_invites to authenticated;
grant execute on function public.my_household_id() to authenticated;
grant execute on function public.household_snapshot() to authenticated;
grant execute on function public.create_household_invite() to authenticated;
grant execute on function public.accept_household_invite(text) to authenticated;
grant execute on function public.leave_household() to authenticated;
grant execute on function public.remove_household_member(uuid) to authenticated;

drop policy if exists "user_indexes_select_own" on public.user_indexes;
drop policy if exists "user_indexes_insert_own" on public.user_indexes;
drop policy if exists "user_indexes_update_own" on public.user_indexes;
drop policy if exists "user_indexes_delete_own" on public.user_indexes;
drop policy if exists "user_indexes_select_household" on public.user_indexes;
drop policy if exists "user_indexes_insert_household" on public.user_indexes;
drop policy if exists "user_indexes_update_household" on public.user_indexes;

create policy "user_indexes_select_household"
  on public.user_indexes for select
  using (auth.uid() = user_id or user_id = public.my_household_id());

create policy "user_indexes_insert_household"
  on public.user_indexes for insert
  with check (auth.uid() = user_id or user_id = public.my_household_id());

create policy "user_indexes_update_household"
  on public.user_indexes for update
  using (auth.uid() = user_id or user_id = public.my_household_id())
  with check (auth.uid() = user_id or user_id = public.my_household_id());

create policy "user_indexes_delete_own"
  on public.user_indexes for delete
  using (auth.uid() = user_id);

drop policy if exists "user_files_select_own" on storage.objects;
drop policy if exists "user_files_insert_own" on storage.objects;
drop policy if exists "user_files_update_own" on storage.objects;
drop policy if exists "user_files_delete_own" on storage.objects;
drop policy if exists "user_files_select_household" on storage.objects;
drop policy if exists "user_files_insert_household" on storage.objects;
drop policy if exists "user_files_update_household" on storage.objects;
drop policy if exists "user_files_delete_household" on storage.objects;

create policy "user_files_select_household"
  on storage.objects for select
  using (
    bucket_id = 'user-files'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or split_part(name, '/', 1) = public.my_household_id()::text
    )
  );

create policy "user_files_insert_household"
  on storage.objects for insert
  with check (
    bucket_id = 'user-files'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or split_part(name, '/', 1) = public.my_household_id()::text
    )
  );

create policy "user_files_update_household"
  on storage.objects for update
  using (
    bucket_id = 'user-files'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or split_part(name, '/', 1) = public.my_household_id()::text
    )
  )
  with check (
    bucket_id = 'user-files'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or split_part(name, '/', 1) = public.my_household_id()::text
    )
  );

create policy "user_files_delete_household"
  on storage.objects for delete
  using (
    bucket_id = 'user-files'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or split_part(name, '/', 1) = public.my_household_id()::text
    )
  );
