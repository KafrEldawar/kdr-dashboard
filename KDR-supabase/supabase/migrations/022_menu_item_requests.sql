-- ============================================================
-- 022: Menu Item Change Requests
--      Owner submits add/edit requests → admin approves in dashboard
-- ============================================================

-- ── Table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.menu_item_change_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  menu_item_id  UUID REFERENCES public.menu_items(id) ON DELETE SET NULL,
  action        TEXT NOT NULL CHECK (action IN ('create', 'update')),
  proposed_data JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  owner_note    TEXT,
  admin_note    TEXT,
  requested_by  UUID NOT NULL REFERENCES auth.users(id),
  reviewed_by   UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcr_restaurant_status
  ON public.menu_item_change_requests(restaurant_id, status);

CREATE INDEX IF NOT EXISTS idx_mcr_menu_item
  ON public.menu_item_change_requests(menu_item_id)
  WHERE menu_item_id IS NOT NULL;

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE public.menu_item_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mcr_owner_select" ON public.menu_item_change_requests;
CREATE POLICY "mcr_owner_select" ON public.menu_item_change_requests
  FOR SELECT USING (restaurant_id = public.get_my_restaurant_id());

DROP POLICY IF EXISTS "mcr_owner_insert" ON public.menu_item_change_requests;
CREATE POLICY "mcr_owner_insert" ON public.menu_item_change_requests
  FOR INSERT WITH CHECK (restaurant_id = public.get_my_restaurant_id());

DROP POLICY IF EXISTS "mcr_admin_all" ON public.menu_item_change_requests;
CREATE POLICY "mcr_admin_all" ON public.menu_item_change_requests
  FOR ALL USING (public.is_admin());


-- ── rpc_owner_get_menu_items (updated to include pending requests) ──
CREATE OR REPLACE FUNCTION public.rpc_owner_get_menu_items()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest_id uuid := public.get_my_restaurant_id();
BEGIN
  IF v_rest_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not a restaurant owner');
  END IF;

  RETURN jsonb_build_object(
    'data', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id',                 mi.id,
        'name_ar',            mi.name_ar,
        'name_en',            coalesce(mi.name_en, ''),
        'description',        coalesce(mi.description_ar, mi.description_en),
        'price',              mi.price,
        'image_url',          mi.image_url,
        'category_id',        mi.category_id,
        'category_name',      (SELECT name_ar FROM categories WHERE id = mi.category_id),
        'is_available',       mi.is_available,
        'pending_request_id', (
          SELECT r.id FROM menu_item_change_requests r
          WHERE r.menu_item_id = mi.id AND r.status = 'pending'
          ORDER BY r.created_at DESC LIMIT 1
        )
      ) ORDER BY mi.sort_order, mi.name_ar), '[]'::jsonb)
      FROM menu_items mi
      WHERE mi.restaurant_id = v_rest_id
    ),
    'pending_creates', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id',            r.id,
        'action',        r.action,
        'status',        r.status,
        'proposed_data', r.proposed_data,
        'owner_note',    r.owner_note,
        'created_at',    r.created_at
      ) ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM menu_item_change_requests r
      WHERE r.restaurant_id = v_rest_id
        AND r.action = 'create'
        AND r.status = 'pending'
    )
  );
END; $$;


-- ── rpc_owner_submit_menu_item_request ─────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_owner_submit_menu_item_request(
  p_action        text,
  p_menu_item_id  uuid  DEFAULT NULL,
  p_proposed_data jsonb DEFAULT NULL,
  p_owner_note    text  DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
  v_req_id  uuid;
BEGIN
  IF v_uid IS NULL OR v_rest_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not a restaurant owner');
  END IF;

  IF p_action NOT IN ('create', 'update') THEN
    RETURN jsonb_build_object('error', 'Invalid action');
  END IF;

  -- Verify ownership for updates
  IF p_action = 'update' THEN
    IF p_menu_item_id IS NULL THEN
      RETURN jsonb_build_object('error', 'menu_item_id is required for update');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM menu_items
      WHERE id = p_menu_item_id AND restaurant_id = v_rest_id
    ) THEN
      RETURN jsonb_build_object('error', 'Menu item not found or access denied');
    END IF;
    -- Supersede any existing pending update for this item
    UPDATE menu_item_change_requests
    SET status = 'rejected',
        admin_note = 'Superseded by newer request',
        reviewed_at = NOW()
    WHERE menu_item_id = p_menu_item_id
      AND status = 'pending'
      AND action = 'update';
  END IF;

  INSERT INTO menu_item_change_requests (
    restaurant_id, menu_item_id, action,
    proposed_data, owner_note, requested_by
  ) VALUES (
    v_rest_id, p_menu_item_id, p_action,
    coalesce(p_proposed_data, '{}'::jsonb),
    p_owner_note, v_uid
  ) RETURNING id INTO v_req_id;

  INSERT INTO audit_logs (user_id, action, table_name, record_id)
  VALUES (v_uid, 'create', 'menu_item_change_requests', v_req_id::text);

  RETURN jsonb_build_object('id', v_req_id, 'status', 'pending');
END; $$;


-- ── rpc_admin_get_menu_item_requests ───────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_get_menu_item_requests(
  p_status    text    DEFAULT 'pending',
  p_page      integer DEFAULT 1,
  p_page_size integer DEFAULT 20
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_offset integer := (p_page - 1) * p_page_size;
  v_total  integer;
  v_data   jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  SELECT count(*) INTO v_total
  FROM menu_item_change_requests
  WHERE (p_status = 'all' OR status = p_status);

  SELECT coalesce(jsonb_agg(t ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_data
  FROM (
    SELECT
      r.id, r.action, r.status,
      r.proposed_data, r.owner_note, r.admin_note,
      r.created_at, r.reviewed_at, r.menu_item_id,
      res.name_ar AS restaurant_name_ar,
      res.name_en AS restaurant_name_en,
      (
        SELECT jsonb_build_object(
          'name_ar', mi.name_ar,
          'name_en', mi.name_en,
          'price',   mi.price
        )
        FROM menu_items mi WHERE mi.id = r.menu_item_id
      ) AS current_item
    FROM menu_item_change_requests r
    JOIN restaurants res ON res.id = r.restaurant_id
    WHERE (p_status = 'all' OR r.status = p_status)
    ORDER BY r.created_at DESC
    LIMIT p_page_size OFFSET v_offset
  ) t;

  RETURN jsonb_build_object(
    'data', v_data,
    'meta', jsonb_build_object(
      'total', v_total,
      'page', p_page,
      'page_size', p_page_size,
      'total_pages', ceil(v_total::numeric / p_page_size)
    )
  );
END; $$;


-- ── rpc_admin_review_menu_item_request ─────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_review_menu_item_request(
  p_request_id uuid,
  p_status     text,
  p_admin_note text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_req     menu_item_change_requests%rowtype;
  v_item_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('error', 'Status must be approved or rejected');
  END IF;

  SELECT * INTO v_req FROM menu_item_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Request not found');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'Request is already ' || v_req.status);
  END IF;

  UPDATE menu_item_change_requests SET
    status      = p_status,
    admin_note  = p_admin_note,
    reviewed_by = v_uid,
    reviewed_at = NOW()
  WHERE id = p_request_id;

  -- Apply the change if approved
  IF p_status = 'approved' THEN
    IF v_req.action = 'create' THEN
      INSERT INTO menu_items (
        restaurant_id, name_ar, name_en,
        description_ar, description_en,
        price, image_url, category_id, is_available, sort_order
      ) VALUES (
        v_req.restaurant_id,
        coalesce(v_req.proposed_data->>'name_ar', ''),
        coalesce(v_req.proposed_data->>'name_en', ''),
        v_req.proposed_data->>'description',
        v_req.proposed_data->>'description',
        coalesce((v_req.proposed_data->>'price')::numeric, 0),
        v_req.proposed_data->>'image_url',
        (v_req.proposed_data->>'category_id')::uuid,
        coalesce((v_req.proposed_data->>'is_available')::boolean, true),
        0
      ) RETURNING id INTO v_item_id;
      -- Link request to the created item
      UPDATE menu_item_change_requests SET menu_item_id = v_item_id WHERE id = p_request_id;

    ELSIF v_req.action = 'update' AND v_req.menu_item_id IS NOT NULL THEN
      UPDATE menu_items SET
        name_ar        = coalesce(v_req.proposed_data->>'name_ar',        name_ar),
        name_en        = coalesce(v_req.proposed_data->>'name_en',        name_en),
        description_ar = coalesce(v_req.proposed_data->>'description',    description_ar),
        description_en = coalesce(v_req.proposed_data->>'description',    description_en),
        price          = coalesce((v_req.proposed_data->>'price')::numeric, price),
        image_url      = coalesce(v_req.proposed_data->>'image_url',      image_url),
        category_id    = coalesce((v_req.proposed_data->>'category_id')::uuid, category_id),
        is_available   = coalesce((v_req.proposed_data->>'is_available')::boolean, is_available),
        updated_at     = NOW()
      WHERE id = v_req.menu_item_id;
    END IF;

    INSERT INTO audit_logs (user_id, action, table_name, record_id)
    VALUES (v_uid, 'update', 'menu_items', coalesce(v_item_id, v_req.menu_item_id)::text);
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_status);
END; $$;


-- ── rpc_owner_upsert_menu_item ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_owner_upsert_menu_item(p_item jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
  v_item_id uuid := (p_item->>'id')::uuid;
BEGIN
  IF v_uid IS NULL OR v_rest_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not a restaurant owner');
  END IF;

  IF v_item_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM menu_items WHERE id = v_item_id AND restaurant_id = v_rest_id
    ) THEN
      RETURN jsonb_build_object('error', 'Menu item not found or access denied');
    END IF;
    UPDATE menu_items SET
      name_ar        = coalesce(p_item->>'name_ar',               name_ar),
      name_en        = coalesce(p_item->>'name_en',               name_en),
      description_ar = coalesce(p_item->>'description',           description_ar),
      description_en = coalesce(p_item->>'description',           description_en),
      price          = coalesce((p_item->>'price')::numeric,       price),
      image_url      = coalesce(p_item->>'image_url',              image_url),
      category_id    = coalesce((p_item->>'category_id')::uuid,    category_id),
      is_available   = coalesce((p_item->>'is_available')::boolean, is_available),
      updated_at     = NOW()
    WHERE id = v_item_id;
    INSERT INTO audit_logs (user_id, action, table_name, record_id)
    VALUES (v_uid, 'update', 'menu_items', v_item_id::text);
  ELSE
    INSERT INTO menu_items (
      restaurant_id, name_ar, name_en,
      description_ar, description_en,
      price, image_url, category_id, is_available, sort_order
    ) VALUES (
      v_rest_id,
      coalesce(p_item->>'name_ar', ''),
      coalesce(p_item->>'name_en', ''),
      p_item->>'description',
      p_item->>'description',
      coalesce((p_item->>'price')::numeric, 0),
      p_item->>'image_url',
      (p_item->>'category_id')::uuid,
      coalesce((p_item->>'is_available')::boolean, true),
      0
    ) RETURNING id INTO v_item_id;
    INSERT INTO audit_logs (user_id, action, table_name, record_id)
    VALUES (v_uid, 'create', 'menu_items', v_item_id::text);
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'id',            mi.id,
      'name_ar',       mi.name_ar,
      'name_en',       coalesce(mi.name_en, ''),
      'description',   coalesce(mi.description_ar, mi.description_en),
      'price',         mi.price,
      'image_url',     mi.image_url,
      'category_id',   mi.category_id,
      'category_name', (SELECT name_ar FROM categories WHERE id = mi.category_id),
      'is_available',  mi.is_available,
      'pending_request_id', NULL::uuid
    )
    FROM menu_items mi WHERE mi.id = v_item_id
  );
END; $$;


-- ── rpc_owner_delete_menu_item ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_owner_delete_menu_item(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
BEGIN
  IF v_uid IS NULL OR v_rest_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not a restaurant owner');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM menu_items WHERE id = p_item_id AND restaurant_id = v_rest_id
  ) THEN
    RETURN jsonb_build_object('error', 'Menu item not found or access denied');
  END IF;

  DELETE FROM menu_items WHERE id = p_item_id;

  INSERT INTO audit_logs (user_id, action, table_name, record_id)
  VALUES (v_uid, 'delete', 'menu_items', p_item_id::text);

  RETURN jsonb_build_object('success', true);
END; $$;


-- ── rpc_owner_toggle_item_availability ─────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_owner_toggle_item_availability(
  p_item_id      uuid,
  p_is_available boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_rest_id uuid := public.get_my_restaurant_id();
BEGIN
  IF v_uid IS NULL OR v_rest_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not a restaurant owner');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM menu_items WHERE id = p_item_id AND restaurant_id = v_rest_id
  ) THEN
    RETURN jsonb_build_object('error', 'Menu item not found or access denied');
  END IF;

  UPDATE menu_items SET is_available = p_is_available, updated_at = NOW()
  WHERE id = p_item_id;

  RETURN (
    SELECT jsonb_build_object(
      'id',            mi.id,
      'name_ar',       mi.name_ar,
      'name_en',       coalesce(mi.name_en, ''),
      'description',   coalesce(mi.description_ar, mi.description_en),
      'price',         mi.price,
      'image_url',     mi.image_url,
      'category_id',   mi.category_id,
      'category_name', (SELECT name_ar FROM categories WHERE id = mi.category_id),
      'is_available',  mi.is_available,
      'pending_request_id', (
        SELECT r.id FROM menu_item_change_requests r
        WHERE r.menu_item_id = mi.id AND r.status = 'pending'
        ORDER BY r.created_at DESC LIMIT 1
      )
    )
    FROM menu_items mi WHERE mi.id = p_item_id
  );
END; $$;
