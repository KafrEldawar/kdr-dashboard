-- ============================================================
-- 020: Owner — order items in response + FCM trigger
-- ============================================================
--
-- REQUIRED SETUP (run once in Supabase SQL editor after applying this migration):
--
--   INSERT INTO public.app_config (key, value) VALUES
--     ('supabase_url',         'https://YOUR_PROJECT_REF.supabase.co'),
--     ('supabase_service_key', 'YOUR_SERVICE_ROLE_KEY')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- ============================================================

-- ── Config table (URL + service key for edge function calls) ──
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

-- Only admins can read/write config
alter table public.app_config enable row level security;

drop policy if exists "app_config: admin only" on public.app_config;
create policy "app_config: admin only"
  on public.app_config for all
  using (public.is_admin());

-- Service-role access needed inside security-definer functions
grant select on public.app_config to service_role;


-- ── rpc_owner_get_orders (add items array) ────────────────────
create or replace function public.rpc_owner_get_orders(
  p_status    text    default null,
  p_page      integer default 1,
  p_page_size integer default 20
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rest_id uuid    := public.get_my_restaurant_id();
  v_offset  integer := (p_page - 1) * p_page_size;
  v_total   integer;
  v_data    jsonb;
begin
  if v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  select count(*) into v_total from orders
  where restaurant_id = v_rest_id
    and (p_status is null or status::text = p_status);

  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_data
  from (
    select
      o.id, o.status, o.total_amount, o.subtotal, o.delivery_fee, o.discount,
      o.delivery_address, o.contact_phone, o.notes, o.created_at, o.updated_at,
      jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone) as customer,
      (select count(*) from order_items oi where oi.order_id = o.id) as items_count,
      (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id',                   oi.id,
            'name_ar',              oi.item_name_ar,
            'name_en',              oi.item_name_en,
            'price',                oi.price,
            'quantity',             oi.quantity,
            'special_instructions', oi.special_instructions
          )
        ), '[]'::jsonb)
        from order_items oi
        where oi.order_id = o.id
      ) as items
    from orders o join profiles p on p.id = o.user_id
    where o.restaurant_id = v_rest_id
      and (p_status is null or o.status::text = p_status)
    order by o.created_at desc
    limit p_page_size offset v_offset
  ) t;

  return jsonb_build_object('data', v_data,
    'meta', jsonb_build_object('total', v_total, 'page', p_page,
      'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)));
end; $$;


-- ── rpc_owner_update_order_status (items + notify customer) ───
create or replace function public.rpc_owner_update_order_status(
  p_order_id   uuid,
  p_new_status text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid         := auth.uid();
  v_rest_id    uuid         := public.get_my_restaurant_id();
  v_cur_status order_status;
  v_new_status order_status;
  v_supa_url   text;
  v_supa_key   text;
begin
  if v_uid is null or v_rest_id is null then
    return jsonb_build_object('error', 'Not a restaurant owner');
  end if;

  begin
    v_new_status := p_new_status::order_status;
  exception when invalid_text_representation then
    return jsonb_build_object('error', 'Invalid status value: ' || p_new_status);
  end;

  select o.status into v_cur_status
  from orders o
  where o.id = p_order_id and o.restaurant_id = v_rest_id;

  if not found then
    return jsonb_build_object('error', 'Order not found or access denied');
  end if;

  if not (
    (v_cur_status = 'pending'          and v_new_status in ('preparing',        'cancelled')) or
    (v_cur_status = 'preparing'        and v_new_status in ('out_for_delivery',  'cancelled')) or
    (v_cur_status = 'out_for_delivery' and v_new_status = 'delivered')
  ) then
    return jsonb_build_object(
      'error', 'Invalid transition from ' || v_cur_status::text || ' to ' || p_new_status
    );
  end if;

  update orders set status = v_new_status, updated_at = now()
  where id = p_order_id;

  insert into audit_logs (user_id, action, table_name, record_id)
  values (v_uid, 'update', 'orders', p_order_id::text);

  -- Notify customer via edge function (fire-and-forget, ignore errors)
  select value into v_supa_url from app_config where key = 'supabase_url';
  select value into v_supa_key from app_config where key = 'supabase_service_key';

  if v_supa_url is not null and v_supa_key is not null then
    begin
      perform net.http_post(
        url     := v_supa_url || '/functions/v1/send-push',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || v_supa_key
        ),
        body    := jsonb_build_object('event', 'status_change', 'order_id', p_order_id)::text
      );
    exception when others then null;
    end;
  end if;

  -- Return updated order with items
  return (
    select jsonb_build_object(
      'id',               o.id,
      'status',           o.status,
      'total_amount',     o.total_amount,
      'subtotal',         o.subtotal,
      'delivery_fee',     o.delivery_fee,
      'discount',         o.discount,
      'delivery_address', o.delivery_address,
      'contact_phone',    o.contact_phone,
      'notes',            o.notes,
      'created_at',       o.created_at,
      'updated_at',       o.updated_at,
      'items_count',      (select count(*) from order_items oi where oi.order_id = o.id),
      'customer',         jsonb_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone),
      'items', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id',                   oi.id,
            'name_ar',              oi.item_name_ar,
            'name_en',              oi.item_name_en,
            'price',                oi.price,
            'quantity',             oi.quantity,
            'special_instructions', oi.special_instructions
          )
        ), '[]'::jsonb)
        from order_items oi where oi.order_id = o.id
      )
    )
    from orders o join profiles p on p.id = o.user_id
    where o.id = p_order_id
  );
end; $$;


-- ── Trigger: notify owner on new order (FCM via pg_net) ───────
create or replace function public.notify_owner_on_new_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_supa_url text;
  v_supa_key text;
begin
  select value into v_supa_url from app_config where key = 'supabase_url';
  select value into v_supa_key from app_config where key = 'supabase_service_key';

  if v_supa_url is null or v_supa_key is null then
    return new;
  end if;

  begin
    perform net.http_post(
      url     := v_supa_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_supa_key
      ),
      body    := jsonb_build_object('event', 'new_order', 'order_id', new.id)::text
    );
  exception when others then null;
  end;

  return new;
end; $$;

drop trigger if exists trigger_new_order_notify on public.orders;
create trigger trigger_new_order_notify
  after insert on public.orders
  for each row execute function public.notify_owner_on_new_order();
