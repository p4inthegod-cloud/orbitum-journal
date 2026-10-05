-- One database transaction owns both payment confirmation and access activation.
-- Row locks serialize retries, so confirming a monthly claim twice never extends twice.
create or replace function public.confirm_andromeda_payment(p_payment_id bigint, p_admin_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare claim public.payments%rowtype; account public.profiles%rowtype;
  final_plan text; expiry timestamptz;
begin
  if not exists(select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  select * into claim from public.payments where id = p_payment_id for update;
  if not found then return jsonb_build_object('error', 'payment_not_found'); end if;
  if claim.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'already_confirmed', true);
  end if;
  if claim.status <> 'pending' then return jsonb_build_object('error', 'payment_not_pending'); end if;
  select * into account from public.profiles where id = claim.user_id for update;
  if not found then return jsonb_build_object('error', 'user_not_found'); end if;
  final_plan := case when account.plan = 'lifetime' then 'lifetime' else claim.plan end;
  if final_plan = 'monthly' then
    expiry := greatest(now(), case when account.plan = 'monthly' then account.plan_expires_at else now() end) + interval '30 days';
  end if;
  update public.profiles set plan = final_plan, plan_expires_at = expiry,
    features = array['journal','dashboard','progress','digest','premarket','coach','aichat','screener']
    where id = claim.user_id;
  update public.payments set status = 'confirmed', confirmed_at = now(), confirmed_by = p_admin_id
    where id = claim.id;
  return jsonb_build_object('ok', true, 'user_id', claim.user_id, 'plan', final_plan, 'expires_at', expiry);
end;
$$;
revoke all on function public.confirm_andromeda_payment(bigint, uuid) from public, anon, authenticated;
grant execute on function public.confirm_andromeda_payment(bigint, uuid) to service_role;
