-- Website inbox: contact messages and account deletion requests submitted from kdr.app

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  subject text not null,
  message text not null,
  source text not null default 'website',
  status text not null default 'new' check (status in ('new','read','resolved','archived')),
  handled_by uuid references public.profiles(id),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists contact_messages_created_at_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_status_idx on public.contact_messages (status);

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  name text not null,
  phone text not null,
  email text,
  auth_method text not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','completed','rejected')),
  source text not null default 'website',
  handled_by uuid references public.profiles(id),
  handled_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists account_deletion_requests_created_at_idx on public.account_deletion_requests (created_at desc);
create index if not exists account_deletion_requests_status_idx on public.account_deletion_requests (status);

alter table public.contact_messages enable row level security;
alter table public.account_deletion_requests enable row level security;

-- Inserts come from the website API using the service role, which bypasses RLS.
-- Only admins can read/update from the dashboard.

drop policy if exists "admins read contact messages" on public.contact_messages;
create policy "admins read contact messages"
  on public.contact_messages for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "admins update contact messages" on public.contact_messages;
create policy "admins update contact messages"
  on public.contact_messages for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "admins read deletion requests" on public.account_deletion_requests;
create policy "admins read deletion requests"
  on public.account_deletion_requests for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "admins update deletion requests" on public.account_deletion_requests;
create policy "admins update deletion requests"
  on public.account_deletion_requests for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
