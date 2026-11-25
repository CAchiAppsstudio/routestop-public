-- The Studio portal shares RouteStop authentication. Its records use a separate
-- allowlist, managed via the Supabase dashboard, and never grant RouteStop access.
create table public.studio_podlegacy_admins (
  user_id uuid primary key references auth.users (id) on delete restrict
);

create table public.studio_podlegacy_incidents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.studio_podlegacy_admins (user_id),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  platform text not null check (platform in ('ios', 'mac', 'both')),
  theme text not null check (theme in ('playback', 'resume', 'access', 'interface', 'other')),
  build text not null default '' check (char_length(build) <= 32),
  details text not null check (char_length(btrim(details)) between 1 and 1500),
  state text not null default 'open' check (state in ('open', 'investigating', 'resolved')),
  resolution text not null default '' check (char_length(resolution) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.studio_podlegacy_releases (
  owner_id uuid not null default auth.uid() references public.studio_podlegacy_admins (user_id),
  platform text not null check (platform in ('ios', 'mac')),
  version text not null check (char_length(version) <= 18 and version ~ '^[0-9]+([.][0-9]+){1,2}$'),
  build text not null check (char_length(build) <= 16 and build ~ '^[0-9]+([.][0-9]+){0,2}$'),
  state text not null check (state in ('testing', 'preparing', 'submitted', 'published', 'archived')),
  observed_on date not null check (observed_on between date '2000-01-01' and (now() at time zone 'Europe/Paris')::date),
  note text not null default '' check (char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  primary key (owner_id, platform, version, build)
);

create table public.studio_podlegacy_downloads (
  owner_id uuid not null default auth.uid() references public.studio_podlegacy_admins (user_id),
  platform text not null check (platform in ('ios', 'mac')),
  observed_on date not null check (observed_on between date '2000-01-01' and (now() at time zone 'Europe/Paris')::date),
  first_downloads integer not null check (first_downloads between 0 and 999999999),
  primary key (owner_id, platform, observed_on)
);

create index studio_podlegacy_incidents_owner_updated_idx
  on public.studio_podlegacy_incidents (owner_id, updated_at desc, id desc);

create index studio_podlegacy_releases_owner_observed_idx
  on public.studio_podlegacy_releases (owner_id, platform, observed_on desc, updated_at desc);

alter table public.studio_podlegacy_admins enable row level security;
alter table public.studio_podlegacy_incidents enable row level security;
alter table public.studio_podlegacy_releases enable row level security;
alter table public.studio_podlegacy_downloads enable row level security;

revoke all on table
  public.studio_podlegacy_admins,
  public.studio_podlegacy_incidents,
  public.studio_podlegacy_releases,
  public.studio_podlegacy_downloads
from public, anon, authenticated;

grant select on public.studio_podlegacy_admins to authenticated;
grant select, insert, update on table
  public.studio_podlegacy_incidents,
  public.studio_podlegacy_releases,
  public.studio_podlegacy_downloads
to authenticated;

create policy studio_podlegacy_membership_read
  on public.studio_podlegacy_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- A record must belong to the signed-in account, which must still be allowed
-- into PodLegacy. The membership lookup uses the allowlist’s primary key.
create policy studio_podlegacy_incidents_owner
  on public.studio_podlegacy_incidents for all to authenticated
  using (owner_id = (select auth.uid()) and (select exists (
    select 1 from public.studio_podlegacy_admins where user_id = (select auth.uid())
  )))
  with check (owner_id = (select auth.uid()) and (select exists (
    select 1 from public.studio_podlegacy_admins where user_id = (select auth.uid())
  )));

create policy studio_podlegacy_releases_owner
  on public.studio_podlegacy_releases for all to authenticated
  using (owner_id = (select auth.uid()) and (select exists (
    select 1 from public.studio_podlegacy_admins where user_id = (select auth.uid())
  )))
  with check (owner_id = (select auth.uid()) and (select exists (
    select 1 from public.studio_podlegacy_admins where user_id = (select auth.uid())
  )));

create policy studio_podlegacy_downloads_owner
  on public.studio_podlegacy_downloads for all to authenticated
  using (owner_id = (select auth.uid()) and (select exists (
    select 1 from public.studio_podlegacy_admins where user_id = (select auth.uid())
  )))
  with check (owner_id = (select auth.uid()) and (select exists (
    select 1 from public.studio_podlegacy_admins where user_id = (select auth.uid())
  )));
