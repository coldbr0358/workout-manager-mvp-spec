begin;

create extension if not exists pgcrypto;

create or replace function public.is_aal2_owner(row_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() = row_user_id and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

revoke all on function public.is_aal2_owner(uuid) from public;
grant execute on function public.is_aal2_owner(uuid) to authenticated, service_role;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '사용자' check (char_length(display_name) between 1 and 30),
  protein_min numeric(6,1) not null default 120 check (protein_min between 30 and 400),
  protein_target_min numeric(6,1) not null default 140 check (protein_target_min between protein_min and 400),
  protein_target_max numeric(6,1) not null default 160 check (protein_target_max between protein_target_min and 400),
  calorie_deficit integer not null default 400 check (calorie_deficit between 0 and 1000),
  base_activity_factor numeric(4,2) not null default 1.35 check (base_activity_factor between 1.1 and 2.2),
  planned_exercise_kcal_week integer not null default 1000 check (planned_exercise_kcal_week between 0 and 10000),
  selected_metric text not null default 'weight' check (char_length(selected_metric) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  eaten_at timestamptz not null,
  name text not null check (char_length(name) between 1 and 80),
  protein_min numeric(7,2) not null check (protein_min between 0 and 1000),
  protein_max numeric(7,2) not null check (protein_max between protein_min and 1000),
  calories_min numeric(8,2) not null check (calories_min between 0 and 20000),
  calories_max numeric(8,2) not null check (calories_max between calories_min and 20000),
  status text not null check (status in ('complete', 'estimated', 'incomplete')),
  source text not null check (source in ('manual', 'photo')),
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now()
);

create table public.workout_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  performed_at timestamptz not null,
  area text not null check (char_length(area) between 1 and 80),
  duration_minutes integer not null check (duration_minutes between 0 and 360),
  completed boolean not null,
  notes text check (notes is null or char_length(notes) <= 300),
  created_at timestamptz not null default now()
);

create table public.workout_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  summary text not null check (char_length(summary) between 1 and 4000),
  weekly_days integer not null check (weekly_days between 0 and 14),
  is_baseline boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index workout_plans_one_baseline_per_user
  on public.workout_plans(user_id) where is_baseline;

create table public.inbody_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  weight numeric(6,2) check (weight is null or weight between 20 and 400),
  skeletal_muscle_mass numeric(6,2) check (skeletal_muscle_mass is null or skeletal_muscle_mass between 3 and 150),
  body_fat_percentage numeric(5,2) check (body_fat_percentage is null or body_fat_percentage between 1 and 75),
  bmr integer check (bmr is null or bmr between 500 and 5000),
  raw_values jsonb not null check (jsonb_typeof(raw_values) = 'object' and pg_column_size(raw_values) <= 262144),
  created_at timestamptz not null default now(),
  unique (user_id, source_hash)
);

create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_type text not null check (analysis_type in ('inbody_change', 'coach_chat', 'nutrition_extract')),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  prompt text check (prompt is null or char_length(prompt) <= 800),
  result jsonb not null check (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 131072),
  created_at timestamptz not null default now(),
  unique (user_id, input_hash)
);

create table public.ai_usage_monthly (
  user_id uuid not null references auth.users(id) on delete cascade,
  month_start date not null,
  request_count integer not null default 0 check (request_count >= 0),
  reserved_tokens bigint not null default 0 check (reserved_tokens >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, month_start)
);

create index food_entries_user_date_idx on public.food_entries(user_id, eaten_at desc);
create index workout_entries_user_date_idx on public.workout_entries(user_id, performed_at desc);
create index inbody_measurements_user_date_idx on public.inbody_measurements(user_id, measured_at desc);
create index ai_analyses_user_date_idx on public.ai_analyses(user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger workout_plans_set_updated_at before update on public.workout_plans for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.food_entries enable row level security;
alter table public.workout_entries enable row level security;
alter table public.workout_plans enable row level security;
alter table public.inbody_measurements enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.ai_usage_monthly enable row level security;

create policy profiles_owner_aal2 on public.profiles for all to authenticated using (public.is_aal2_owner(user_id)) with check (public.is_aal2_owner(user_id));
create policy food_entries_owner_aal2 on public.food_entries for all to authenticated using (public.is_aal2_owner(user_id)) with check (public.is_aal2_owner(user_id));
create policy workout_entries_owner_aal2 on public.workout_entries for all to authenticated using (public.is_aal2_owner(user_id)) with check (public.is_aal2_owner(user_id));
create policy workout_plans_owner_aal2 on public.workout_plans for all to authenticated using (public.is_aal2_owner(user_id)) with check (public.is_aal2_owner(user_id));
create policy inbody_measurements_owner_aal2 on public.inbody_measurements for all to authenticated using (public.is_aal2_owner(user_id)) with check (public.is_aal2_owner(user_id));
create policy ai_analyses_owner_aal2 on public.ai_analyses for select to authenticated using (public.is_aal2_owner(user_id));

revoke all on public.profiles, public.food_entries, public.workout_entries, public.workout_plans, public.inbody_measurements, public.ai_analyses, public.ai_usage_monthly from anon;
grant select, insert, update, delete on public.profiles, public.food_entries, public.workout_entries, public.workout_plans, public.inbody_measurements to authenticated;
grant select on public.ai_analyses to authenticated;

create or replace function public.reserve_ai_usage(
  p_user_id uuid,
  p_reserved_tokens integer,
  p_request_limit integer,
  p_token_limit bigint
)
returns table(request_count integer, reserved_tokens bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_month date := date_trunc('month', now())::date;
begin
  if p_reserved_tokens < 1 or p_reserved_tokens > 20000 then
    raise exception 'invalid_token_reservation';
  end if;

  insert into public.ai_usage_monthly(user_id, month_start)
  values (p_user_id, current_month)
  on conflict (user_id, month_start) do nothing;

  return query
  update public.ai_usage_monthly
  set request_count = ai_usage_monthly.request_count + 1,
      reserved_tokens = ai_usage_monthly.reserved_tokens + p_reserved_tokens,
      updated_at = now()
  where user_id = p_user_id
    and month_start = current_month
    and ai_usage_monthly.request_count < p_request_limit
    and ai_usage_monthly.reserved_tokens + p_reserved_tokens <= p_token_limit
  returning ai_usage_monthly.request_count, ai_usage_monthly.reserved_tokens;

  if not found then
    raise exception 'ai_usage_limit_exceeded';
  end if;
end;
$$;

revoke all on function public.reserve_ai_usage(uuid, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, integer, integer, bigint) to service_role;

commit;
