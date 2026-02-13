create table if not exists public.platform_admins (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

-- opcional: integridad referencial con profiles (si existe y user_id es PK)
-- alter table public.platform_admins
--   add constraint platform_admins_user_id_fkey
--   foreign key (user_id) references public.profiles(user_id) on delete cascade;
