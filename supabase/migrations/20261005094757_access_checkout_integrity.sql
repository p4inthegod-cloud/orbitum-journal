-- Keep retries (including concurrent requests from two tabs) on one pending claim.
create unique index if not exists payments_one_pending_per_user
  on public.payments(user_id) where status = 'pending';
create unique index if not exists payments_unique_active_tx
  on public.payments(lower(tx_hash))
  where tx_hash is not null and tx_hash <> '' and status in ('pending', 'confirmed');

-- RLS limits rows; this trigger also protects privileged columns on those rows.
-- Personal name/username/Telegram preferences remain editable by their owner.
create or replace function public.guard_profile_access_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if new.id is distinct from old.id
      or new.role is distinct from old.role
      or new.plan is distinct from old.plan
      or new.plan_expires_at is distinct from old.plan_expires_at
      or new.features is distinct from old.features then
      raise exception 'Access fields can only be changed by an administrator' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_profile_access_fields() from public, anon, authenticated;
drop trigger if exists guard_profile_access_fields on public.profiles;
create trigger guard_profile_access_fields before update on public.profiles
  for each row execute function public.guard_profile_access_fields();

-- Support the previous checkout during cached-page rollouts, while validating
-- price and status in the database as well as in the new server handler.
create or replace function public.guard_payment_claim()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare expected_price numeric;
begin
  select price into expected_price from public.products
    where id = new.plan and is_active = true and currency = 'USDT';
  if expected_price is null or expected_price <= 0 or new.amount_usdt is distinct from expected_price then
    raise exception 'Payment price does not match an active product' using errcode = '23514';
  end if;
  if new.status is distinct from 'pending' or new.confirmed_at is not null or new.confirmed_by is not null then
    raise exception 'A payment claim must start pending verification' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_payment_claim() from public, anon, authenticated;
drop trigger if exists guard_payment_claim on public.payments;
create trigger guard_payment_claim before insert on public.payments
  for each row execute function public.guard_payment_claim();
