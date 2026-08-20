-- PhoneMark account, device, and benchmark schema
-- Run this migration in the Supabase SQL editor before using account-backed features.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  contact_email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

create table if not exists public.device_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cpu_model text not null,
  gpu_model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists device_configs_user_id_idx
  on public.device_configs (user_id);

create table if not exists public.benchmark_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  username text,
  device_config_id uuid references public.device_configs(id) on delete set null,
  device_name text,
  cpu_model text,
  gpu_model text,
  benchmark_version text,
  device_confidence integer,
  os text,
  browser text,
  cpu_cores integer,
  device_memory_gb numeric,
  gpu_renderer text,
  webgpu_available boolean,
  webgl_version text,
  screen_width integer,
  screen_height integer,
  device_pixel_ratio numeric,
  cpu_score numeric,
  gpu_score numeric,
  hybrid_score numeric,
  overall_score numeric,
  cpu_ops_per_sec numeric,
  gpu_avg_fps numeric,
  gpu_1pct_low numeric,
  hybrid_avg_fps numeric,
  duration_ms integer,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Add the new columns to an existing PhoneMark benchmark_results table.
alter table public.benchmark_results add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.benchmark_results add column if not exists username text;
alter table public.benchmark_results add column if not exists device_config_id uuid references public.device_configs(id) on delete set null;
alter table public.benchmark_results add column if not exists cpu_model text;
alter table public.benchmark_results add column if not exists gpu_model text;

create index if not exists benchmark_results_cpu_model_idx
  on public.benchmark_results (lower(trim(cpu_model)));
create index if not exists benchmark_results_gpu_model_idx
  on public.benchmark_results (lower(trim(gpu_model)));
create index if not exists benchmark_results_overall_score_idx
  on public.benchmark_results (overall_score desc);
create index if not exists benchmark_results_created_at_idx
  on public.benchmark_results (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists device_configs_set_updated_at on public.device_configs;
create trigger device_configs_set_updated_at
before update on public.device_configs
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, contact_email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'contact_email', '')
  )
  on conflict (id) do update set
    username = excluded.username,
    contact_email = coalesce(excluded.contact_email, public.profiles.contact_email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

drop function if exists public.benchmark_averages(text, text);

create or replace function public.benchmark_averages(
  p_cpu_model text,
  p_gpu_model text,
  p_exclude_id text default null
)
returns table (
  cpu_average numeric,
  cpu_count bigint,
  gpu_average numeric,
  gpu_count bigint,
  hybrid_average numeric,
  hybrid_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    avg(cpu_score) filter (
      where lower(trim(coalesce(cpu_model, ''))) = lower(trim(coalesce(p_cpu_model, '')))
    ),
    count(*) filter (
      where lower(trim(coalesce(cpu_model, ''))) = lower(trim(coalesce(p_cpu_model, '')))
    ),
    avg(gpu_score) filter (
      where lower(trim(coalesce(gpu_model, ''))) = lower(trim(coalesce(p_gpu_model, '')))
    ),
    count(*) filter (
      where lower(trim(coalesce(gpu_model, ''))) = lower(trim(coalesce(p_gpu_model, '')))
    ),
    avg(hybrid_score) filter (
      where lower(trim(coalesce(cpu_model, ''))) = lower(trim(coalesce(p_cpu_model, '')))
        and lower(trim(coalesce(gpu_model, ''))) = lower(trim(coalesce(p_gpu_model, '')))
    ),
    count(*) filter (
      where lower(trim(coalesce(cpu_model, ''))) = lower(trim(coalesce(p_cpu_model, '')))
        and lower(trim(coalesce(gpu_model, ''))) = lower(trim(coalesce(p_gpu_model, '')))
    )
  from public.benchmark_results
  where p_exclude_id is null or id::text <> p_exclude_id;
$$;

grant execute on function public.benchmark_averages(text, text, text) to anon, authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.device_configs to authenticated;
grant select, insert, update, delete on public.benchmark_results to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.device_configs enable row level security;
alter table public.benchmark_results enable row level security;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "Users can create their profile" on public.profiles;
create policy "Users can create their profile"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Users can manage their devices" on public.device_configs;
create policy "Users can manage their devices"
on public.device_configs for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Anyone can read benchmark scores" on public.benchmark_results;
create policy "Anyone can read benchmark scores"
on public.benchmark_results for select
using (true);

drop policy if exists "Anyone can submit benchmark scores" on public.benchmark_results;
create policy "Anyone can submit benchmark scores"
on public.benchmark_results for insert
with check (user_id is null or auth.uid() = user_id);

drop policy if exists "Users can update their benchmark scores" on public.benchmark_results;
create policy "Users can update their benchmark scores"
on public.benchmark_results for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their benchmark scores" on public.benchmark_results;
create policy "Users can delete their benchmark scores"
on public.benchmark_results for delete
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable"
on storage.objects for select
using (bucket_id = 'avatars');

drop policy if exists "Users can upload their avatar" on storage.objects;
create policy "Users can upload their avatar"
on storage.objects for insert
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update their avatar" on storage.objects;
create policy "Users can update their avatar"
on storage.objects for update
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete their avatar" on storage.objects;
create policy "Users can delete their avatar"
on storage.objects for delete
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
