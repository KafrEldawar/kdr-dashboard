-- ============================================================
-- 036: rpc_admin_delete_whatsapp_campaign
-- ============================================================
-- The whatsapp_campaigns RLS only exposes a SELECT policy to admins,
-- so a raw `delete from whatsapp_campaigns where id = X` from the
-- dashboard silently affects 0 rows. Wrap the delete in a security-
-- definer RPC that checks is_admin().
--
-- Recipients cascade via the FK; send_log rows set campaign_id NULL
-- (audit trail preserved).
-- ============================================================

create or replace function public.rpc_admin_delete_whatsapp_campaign(
  p_campaign_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_deleted integer := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('error', 'Access denied');
  end if;

  delete from whatsapp_campaigns where id = p_campaign_id;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    return jsonb_build_object('error', 'Campaign not found');
  end if;

  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end; $$;

grant execute on function public.rpc_admin_delete_whatsapp_campaign(uuid)
  to authenticated;
