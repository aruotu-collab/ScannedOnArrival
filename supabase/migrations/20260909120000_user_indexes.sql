create table if not exists public.user_indexes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  documents jsonb not null default '[]'::jsonb,
  deleted jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_indexes enable row level security;

drop policy if exists "user_indexes_select_own" on public.user_indexes;
drop policy if exists "user_indexes_insert_own" on public.user_indexes;
drop policy if exists "user_indexes_update_own" on public.user_indexes;
drop policy if exists "user_indexes_delete_own" on public.user_indexes;

create policy "user_indexes_select_own"
  on public.user_indexes for select
  using (auth.uid() = user_id);

create policy "user_indexes_insert_own"
  on public.user_indexes for insert
  with check (auth.uid() = user_id);

create policy "user_indexes_update_own"
  on public.user_indexes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_indexes_delete_own"
  on public.user_indexes for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_indexes to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-files',
  'user-files',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/octet-stream']
)
on conflict (id) do update
set file_size_limit = excluded.file_size_limit;

drop policy if exists "user_files_select_own" on storage.objects;
drop policy if exists "user_files_insert_own" on storage.objects;
drop policy if exists "user_files_update_own" on storage.objects;
drop policy if exists "user_files_delete_own" on storage.objects;

create policy "user_files_select_own"
  on storage.objects for select
  using (bucket_id = 'user-files' and split_part(name, '/', 1) = auth.uid()::text);

create policy "user_files_insert_own"
  on storage.objects for insert
  with check (bucket_id = 'user-files' and split_part(name, '/', 1) = auth.uid()::text);

create policy "user_files_update_own"
  on storage.objects for update
  using (bucket_id = 'user-files' and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id = 'user-files' and split_part(name, '/', 1) = auth.uid()::text);

create policy "user_files_delete_own"
  on storage.objects for delete
  using (bucket_id = 'user-files' and split_part(name, '/', 1) = auth.uid()::text);
