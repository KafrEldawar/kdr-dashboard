-- ============================================================
-- 017: Missing Tables
--   - user_addresses          (saved delivery addresses per user)
--   - user_favorite_restaurants (user ↔ restaurant M2M)
--   - order_status_history    (audit trail of status changes)
--   - branch_working_hours    (weekly schedule per branch)
--   - menu_item_options        (e.g. size, extras)
--   - menu_item_option_choices (choices per option)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────────────────────

-- ── user_addresses ────────────────────────────────────────────
create table public.user_addresses (
  id           uuid         primary key default gen_random_uuid(),
  user_id      uuid         not null references public.profiles(id) on delete cascade,
  label        text         not null default 'المنزل',
  address_ar   text         not null,
  address_en   text,
  location_url text,
  is_default   boolean      not null default false,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now()
);

-- ── user_favorite_restaurants ─────────────────────────────────
create table public.user_favorite_restaurants (
  user_id       uuid  not null references public.profiles(id)     on delete cascade,
  restaurant_id uuid  not null references public.restaurants(id)  on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);

-- ── order_status_history ──────────────────────────────────────
-- Append-only log; auto-populated by trigger on orders.status change.
create table public.order_status_history (
  id          uuid         primary key default gen_random_uuid(),
  order_id    uuid         not null references public.orders(id) on delete cascade,
  status      public.order_status not null,
  notes       text,
  changed_by  uuid         references public.profiles(id) on delete set null,
  created_at  timestamptz  not null default now()
);

-- ── branch_working_hours ──────────────────────────────────────
-- day_of_week: 0 = Sunday … 6 = Saturday
create table public.branch_working_hours (
  id          uuid      primary key default gen_random_uuid(),
  branch_id   uuid      not null references public.branches(id) on delete cascade,
  day_of_week smallint  not null check (day_of_week between 0 and 6),
  open_time   time,
  close_time  time,
  is_closed   boolean   not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint unique_branch_day unique (branch_id, day_of_week)
);

-- ── menu_item_options ─────────────────────────────────────────
-- Groupings like "الحجم", "الإضافات", "درجة الحرارة"
create table public.menu_item_options (
  id              uuid    primary key default gen_random_uuid(),
  menu_item_id    uuid    not null references public.menu_items(id) on delete cascade,
  name_ar         text    not null,
  name_en         text,
  is_required     boolean not null default false,
  allow_multiple  boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── menu_item_option_choices ──────────────────────────────────
-- Individual choices: "صغير", "وسط +5ج", "كبير +10ج"
create table public.menu_item_option_choices (
  id           uuid         primary key default gen_random_uuid(),
  option_id    uuid         not null references public.menu_item_options(id) on delete cascade,
  name_ar      text         not null,
  name_en      text,
  price_extra  numeric(8,2) not null default 0 check (price_extra >= 0),
  is_available boolean      not null default true,
  sort_order   integer      not null default 0,
  created_at   timestamptz  not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────

create index idx_user_addresses_user_id        on public.user_addresses(user_id);
create index idx_user_addresses_is_default     on public.user_addresses(user_id, is_default);
create index idx_user_favorites_user_id        on public.user_favorite_restaurants(user_id);
create index idx_user_favorites_restaurant_id  on public.user_favorite_restaurants(restaurant_id);
create index idx_order_status_history_order_id on public.order_status_history(order_id);
create index idx_branch_working_hours_branch   on public.branch_working_hours(branch_id);
create index idx_menu_item_options_item_id     on public.menu_item_options(menu_item_id);
create index idx_menu_item_choices_option_id   on public.menu_item_option_choices(option_id);

-- ─────────────────────────────────────────────────────────────
-- TRIGGERS — updated_at
-- ─────────────────────────────────────────────────────────────

create trigger trg_user_addresses_updated_at
  before update on public.user_addresses
  for each row execute function public.set_updated_at();

create trigger trg_branch_working_hours_updated_at
  before update on public.branch_working_hours
  for each row execute function public.set_updated_at();

create trigger trg_menu_item_options_updated_at
  before update on public.menu_item_options
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- TRIGGER — enforce single default address per user
-- ─────────────────────────────────────────────────────────────

create or replace function public.enforce_single_default_address()
returns trigger language plpgsql as $$
begin
  if new.is_default then
    update public.user_addresses
    set is_default = false
    where user_id = new.user_id
      and id <> new.id;
  end if;
  return new;
end; $$;

create trigger trg_single_default_address
  after insert or update of is_default on public.user_addresses
  for each row when (new.is_default = true)
  execute function public.enforce_single_default_address();

-- ─────────────────────────────────────────────────────────────
-- TRIGGER — auto-log order status changes
-- ─────────────────────────────────────────────────────────────

create or replace function public.log_order_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') or (old.status is distinct from new.status) then
    insert into public.order_status_history (order_id, status, changed_by)
    values (new.id, new.status, auth.uid());
  end if;
  return new;
end; $$;

create trigger trg_log_order_status
  after insert or update of status on public.orders
  for each row execute function public.log_order_status_change();

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────

alter table public.user_addresses             enable row level security;
alter table public.user_favorite_restaurants  enable row level security;
alter table public.order_status_history       enable row level security;
alter table public.branch_working_hours       enable row level security;
alter table public.menu_item_options          enable row level security;
alter table public.menu_item_option_choices   enable row level security;

-- ── user_addresses ────────────────────────────────────────────
create policy "user_addresses: user manages own"
  on public.user_addresses for all
  using (user_id = auth.uid() or public.is_admin());

-- ── user_favorite_restaurants ─────────────────────────────────
create policy "favorites: user manages own"
  on public.user_favorite_restaurants for all
  using (user_id = auth.uid() or public.is_admin());

create policy "favorites: public count visible"
  on public.user_favorite_restaurants for select
  using (true);

-- ── order_status_history ──────────────────────────────────────
create policy "order_status_history: user reads own orders"
  on public.order_status_history for select
  using (
    order_id in (select id from public.orders where user_id = auth.uid())
    or public.is_admin()
    or order_id in (
      select o.id from public.orders o
      join public.restaurant_owners ro on ro.restaurant_id = o.restaurant_id
      where ro.user_id = auth.uid()
    )
  );

create policy "order_status_history: admin full access"
  on public.order_status_history for all
  using (public.is_admin());

-- ── branch_working_hours ──────────────────────────────────────
create policy "branch_working_hours: public read"
  on public.branch_working_hours for select using (true);

create policy "branch_working_hours: admin manage"
  on public.branch_working_hours for all using (public.is_admin());

create policy "branch_working_hours: owner manage own"
  on public.branch_working_hours for all
  using (
    branch_id in (
      select b.id from public.branches b
      join public.restaurant_owners ro on ro.restaurant_id = b.restaurant_id
      where ro.user_id = auth.uid()
    )
  );

-- ── menu_item_options ─────────────────────────────────────────
create policy "menu_item_options: public read"
  on public.menu_item_options for select using (true);

create policy "menu_item_options: admin manage"
  on public.menu_item_options for all using (public.is_admin());

create policy "menu_item_options: owner manage own"
  on public.menu_item_options for all
  using (
    menu_item_id in (
      select id from public.menu_items
      where restaurant_id = public.get_my_restaurant_id()
    )
  );

-- ── menu_item_option_choices ──────────────────────────────────
create policy "menu_item_option_choices: public read"
  on public.menu_item_option_choices for select using (true);

create policy "menu_item_option_choices: admin manage"
  on public.menu_item_option_choices for all using (public.is_admin());

create policy "menu_item_option_choices: owner manage own"
  on public.menu_item_option_choices for all
  using (
    option_id in (
      select mio.id from public.menu_item_options mio
      join public.menu_items mi on mi.id = mio.menu_item_id
      where mi.restaurant_id = public.get_my_restaurant_id()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- RPC FUNCTIONS (admin)
-- ─────────────────────────────────────────────────────────────

-- ── rpc_admin_manage_working_hours ────────────────────────────
-- Upserts a full week schedule for a branch (7 rows).
-- p_hours: [{day_of_week, open_time, close_time, is_closed}, ...]
create or replace function public.rpc_admin_manage_working_hours(
  p_branch_id uuid,
  p_hours     jsonb   -- array of {day_of_week, open_time, close_time, is_closed}
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hour jsonb;
begin
  if not (public.is_admin() or p_branch_id in (
    select b.id from branches b
    join restaurant_owners ro on ro.restaurant_id = b.restaurant_id
    where ro.user_id = auth.uid()
  )) then
    return jsonb_build_object('error', 'Access denied');
  end if;

  for v_hour in select * from jsonb_array_elements(p_hours)
  loop
    insert into branch_working_hours (branch_id, day_of_week, open_time, close_time, is_closed)
    values (
      p_branch_id,
      (v_hour->>'day_of_week')::smallint,
      (v_hour->>'open_time')::time,
      (v_hour->>'close_time')::time,
      coalesce((v_hour->>'is_closed')::boolean, false)
    )
    on conflict (branch_id, day_of_week) do update set
      open_time  = excluded.open_time,
      close_time = excluded.close_time,
      is_closed  = excluded.is_closed,
      updated_at = now();
  end loop;

  return (
    select coalesce(jsonb_agg(to_jsonb(h) order by h.day_of_week), '[]'::jsonb)
    from branch_working_hours h where h.branch_id = p_branch_id
  );
end; $$;

-- ── rpc_admin_get_working_hours ───────────────────────────────
create or replace function public.rpc_admin_get_working_hours(p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(h) order by h.day_of_week), '[]'::jsonb)
    from branch_working_hours h where h.branch_id = p_branch_id
  );
end; $$;

-- ── rpc_admin_list_addresses ──────────────────────────────────
create or replace function public.rpc_admin_list_addresses(
  p_user_id   uuid    default null,
  p_page      integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  select count(*) into v_total from user_addresses a
  where (p_user_id is null or a.user_id = p_user_id);

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select a.*, p.full_name as user_name, p.phone as user_phone
    from user_addresses a
    join profiles p on p.id = a.user_id
    where (p_user_id is null or a.user_id = p_user_id)
    order by a.user_id, a.is_default desc, a.created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;

-- ── rpc_admin_list_favorites ──────────────────────────────────
create or replace function public.rpc_admin_list_favorites(
  p_user_id       uuid    default null,
  p_restaurant_id uuid    default null,
  p_page          integer default 1,
  p_page_size     integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  select count(*) into v_total from user_favorite_restaurants f
  where (p_user_id       is null or f.user_id       = p_user_id)
    and (p_restaurant_id is null or f.restaurant_id = p_restaurant_id);

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select
      f.user_id, f.restaurant_id, f.created_at,
      p.full_name as user_name,
      r.name_ar as restaurant_name_ar, r.name_en as restaurant_name_en
    from user_favorite_restaurants f
    join profiles    p on p.id = f.user_id
    join restaurants r on r.id = f.restaurant_id
    where (p_user_id       is null or f.user_id       = p_user_id)
      and (p_restaurant_id is null or f.restaurant_id = p_restaurant_id)
    order by f.created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page, 'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;

-- ── rpc_admin_get_order_history ───────────────────────────────
create or replace function public.rpc_admin_get_order_history(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;
  return (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', h.id,
        'status', h.status,
        'notes', h.notes,
        'created_at', h.created_at,
        'changed_by', jsonb_build_object('id', p.id, 'full_name', p.full_name)
      ) order by h.created_at
    ), '[]'::jsonb)
    from order_status_history h
    left join profiles p on p.id = h.changed_by
    where h.order_id = p_order_id
  );
end; $$;

-- ── rpc_admin_manage_menu_option ─────────────────────────────
-- action: 'create_option' | 'update_option' | 'delete_option'
--       | 'create_choice' | 'update_choice' | 'delete_choice'
create or replace function public.rpc_admin_manage_menu_option(
  p_action       text,
  p_id           uuid    default null,
  p_menu_item_id uuid    default null,
  p_option_id    uuid    default null,
  p_name_ar      text    default null,
  p_name_en      text    default null,
  p_is_required  boolean default null,
  p_allow_multiple boolean default null,
  p_price_extra  numeric default null,
  p_is_available boolean default null,
  p_sort_order   integer default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if not public.is_admin() then return jsonb_build_object('error', 'Access denied'); end if;

  case p_action
    when 'create_option' then
      insert into menu_item_options (menu_item_id, name_ar, name_en, is_required, allow_multiple, sort_order)
      values (p_menu_item_id, p_name_ar, coalesce(p_name_en,''), coalesce(p_is_required,false),
              coalesce(p_allow_multiple,false), coalesce(p_sort_order,0))
      returning id into v_id;

    when 'update_option' then
      update menu_item_options set
        name_ar        = coalesce(p_name_ar,       name_ar),
        name_en        = coalesce(p_name_en,        name_en),
        is_required    = coalesce(p_is_required,    is_required),
        allow_multiple = coalesce(p_allow_multiple, allow_multiple),
        sort_order     = coalesce(p_sort_order,     sort_order),
        updated_at     = now()
      where id = p_id;
      v_id := p_id;

    when 'delete_option' then
      delete from menu_item_options where id = p_id;
      return jsonb_build_object('success', true);

    when 'create_choice' then
      insert into menu_item_option_choices (option_id, name_ar, name_en, price_extra, is_available, sort_order)
      values (p_option_id, p_name_ar, p_name_en, coalesce(p_price_extra,0),
              coalesce(p_is_available,true), coalesce(p_sort_order,0))
      returning id into v_id;

    when 'update_choice' then
      update menu_item_option_choices set
        name_ar     = coalesce(p_name_ar,      name_ar),
        name_en     = coalesce(p_name_en,      name_en),
        price_extra = coalesce(p_price_extra,  price_extra),
        is_available= coalesce(p_is_available, is_available),
        sort_order  = coalesce(p_sort_order,   sort_order)
      where id = p_id;
      v_id := p_id;

    when 'delete_choice' then
      delete from menu_item_option_choices where id = p_id;
      return jsonb_build_object('success', true);

    else
      return jsonb_build_object('error', 'Invalid action');
  end case;

  insert into audit_logs (user_id, action, table_name, record_id)
  values (v_uid,
    case when p_action like '%create%' then 'create' when p_action like '%update%' then 'update' else 'delete' end::audit_action,
    case when p_action like '%option%' then 'menu_item_options' else 'menu_item_option_choices' end,
    v_id::text);

  return jsonb_build_object('success', true, 'id', v_id);
end; $$;

-- ── Grant supabase_auth_admin access (consistent with other tables) ─
grant select on public.user_addresses            to supabase_auth_admin;
grant select on public.user_favorite_restaurants to supabase_auth_admin;
grant select on public.order_status_history      to supabase_auth_admin;
grant select on public.branch_working_hours      to supabase_auth_admin;
grant select on public.menu_item_options         to supabase_auth_admin;
grant select on public.menu_item_option_choices  to supabase_auth_admin;
