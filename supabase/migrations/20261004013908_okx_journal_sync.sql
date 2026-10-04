-- Only the authenticated server can retrieve or use exchange credentials.
create table public.okx_connections (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references public.profiles(id) on delete cascade,
 secret_id uuid,
 account_uid text,
 key_hint text,
 region text not null default 'global' check(region in ('global','eu','us','tr')),
 demo boolean not null default false,
 enabled boolean not null default false,
 created_at timestamptz not null default now(),
 last_sync_at timestamptz,
 last_started_at timestamptz,
 lease uuid,
 lease_until timestamptz,
 last_error text,
 counts jsonb not null default '{}'::jsonb,
 check(not enabled or secret_id is not null)
);
alter table public.okx_connections enable row level security;
revoke all on public.okx_connections from public, anon, authenticated;
grant select,insert,update,delete on public.okx_connections to service_role;

alter table public.trades add column exchange text check(exchange is null or exchange='okx');
alter table public.trades add column exchange_uid text;
alter table public.trades add constraint trades_exchange_identity_check check((exchange is null and exchange_uid is null) or (exchange='okx' and exchange_uid is not null));
create unique index trades_exchange_identity on public.trades(user_id,exchange,exchange_uid);

create schema if not exists private;
create or replace function private.okx_guard_trade() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(auth.role(),'')='service_role' or current_user in ('postgres','supabase_admin','supabase_auth_admin') then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_op='INSERT' and new.exchange is not null then raise exception 'Imported positions are server managed'; end if;
 if tg_op='DELETE' then
  if old.exchange is not null then raise exception 'Imported positions are server managed'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and (old.exchange is not null or new.exchange is not null) then
  if (to_jsonb(old)-array['note_why','note_feel','note_lesson','setup_type','emotion_conf','emotion_fear','emotion_greed','emotion_calm','notes','tags','emotion','ritual_score']) is distinct from
     (to_jsonb(new)-array['note_why','note_feel','note_lesson','setup_type','emotion_conf','emotion_fear','emotion_greed','emotion_calm','notes','tags','emotion','ritual_score']) then
   raise exception 'Imported position levels and results are server managed';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.okx_guard_trade() from public,anon,authenticated;
create trigger okx_guard_trade before insert or update or delete on public.trades for each row execute function private.okx_guard_trade();

-- SECURITY INVOKER: existing service_role Vault privileges suffice; no public definer functions.
create function public.okx_journal_service(operation text,owner uuid default null,value jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.okx_connections; secret uuid; item jsonb; answer jsonb; now_at timestamptz:=clock_timestamp(); allowed boolean;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 if operation='cron' then
  select exists(select 1 from vault.decrypted_secrets where name='okx_journal_cron' and decrypted_secret=value->>'token') into allowed;
  if not allowed then return null; end if;
  return coalesce((select jsonb_agg(user_id) from (select user_id from public.okx_connections where enabled and (last_sync_at is null or last_sync_at<now_at-interval '45 seconds') and (lease_until is null or lease_until<now_at) order by last_sync_at nulls first limit 6) q),'[]'::jsonb);
 end if;
 if owner is null then raise exception 'Owner required'; end if;
 if operation='connect' then
  insert into public.okx_connections(user_id) values(owner) on conflict(user_id) do nothing;
  select * into c from public.okx_connections where user_id=owner for update;
  secret:=vault.create_secret((value->'credentials')::text,'okx_connection_'||gen_random_uuid()::text,'Read-only OKX journal connection');
  update public.okx_connections set secret_id=secret,account_uid=value->>'account_uid',key_hint=value->>'key_hint',region=value->'credentials'->>'region',demo=(value->'credentials'->>'demo')::boolean,enabled=true,
   created_at=case when account_uid is distinct from value->>'account_uid' then now_at else created_at end,
   lease=null,lease_until=null,last_started_at=null,last_error=null,last_sync_at=null,counts='{}'::jsonb where user_id=owner;
  if c.secret_id is not null then delete from vault.secrets where id=c.secret_id; end if;
  update public.trades set payload=jsonb_set(payload,'{exchange,sync_state}','"paused"'::jsonb) where user_id=owner and exchange='okx' and status='open';
  return jsonb_build_object('connected',true);
 end if;
 select * into c from public.okx_connections where user_id=owner;
 if operation='status' then
  if c.id is null then return jsonb_build_object('connected',false); end if;
  return jsonb_build_object('connected',c.enabled,'region',c.region,'demo',c.demo,'key_hint',c.key_hint,'account_hint',right(c.account_uid,4),'last_sync_at',c.last_sync_at,'last_error',c.last_error,'counts',c.counts);
 end if;
 if c.id is null then return null; end if;
 if operation='disconnect' then
  select * into c from public.okx_connections where user_id=owner for update;
  update public.okx_connections set enabled=false,secret_id=null,lease=null,lease_until=null,last_error=null where user_id=owner;
  delete from vault.secrets where id=c.secret_id;
  update public.trades set payload=jsonb_set(payload,'{exchange,sync_state}','"paused"'::jsonb) where user_id=owner and exchange='okx' and status='open';
  return jsonb_build_object('connected',false);
 end if;
 if operation='claim' then
  select * into c from public.okx_connections where user_id=owner for update;
  if not c.enabled or c.lease_until>now_at or c.last_started_at>now_at-interval '8 seconds' then return null; end if;
  update public.okx_connections set lease=gen_random_uuid(),lease_until=now_at+interval '45 seconds',last_started_at=now_at where user_id=owner returning * into c;
  select (decrypted_secret::jsonb) into answer from vault.decrypted_secrets where id=c.secret_id;
  if answer is null then raise exception 'Credential unavailable'; end if;
  return (to_jsonb(c)-'secret_id')||jsonb_build_object('credentials',answer);
 end if;
 if operation in ('finish','fail') then
  select * into c from public.okx_connections where user_id=owner for update;
  if not c.enabled or c.lease is null or c.lease_until<now_at or c.lease is distinct from (value->>'lease')::uuid then return null; end if;
  if operation='fail' then
   update public.okx_connections set lease=null,lease_until=null,last_error=left(value->>'error',60) where user_id=owner;
   return 'true'::jsonb;
  end if;
  if jsonb_typeof(value->'rows')<>'array' or jsonb_array_length(value->'rows')>1000 then raise exception 'Invalid snapshot'; end if;
  for item in select jsonb_array_elements(value->'rows') loop
   insert into public.trades(user_id,exchange,exchange_uid,pair,direction,status,result,pnl_usd,pnl_pct,entry_price,exit_price,deposit,leverage,stop_loss,take_profit,created_at,payload)
   values(owner,'okx',item->>'exchange_uid',item->>'pair',item->>'direction',item->>'status',item->>'result',(item->>'pnl_usd')::numeric,(item->>'pnl_pct')::numeric,(item->>'entry_price')::numeric,(item->>'exit_price')::numeric,(item->>'deposit')::numeric,(item->>'leverage')::numeric,(item->>'stop_loss')::numeric,(item->>'take_profit')::numeric,(item->>'created_at')::timestamptz,item->'payload')
   on conflict(user_id,exchange,exchange_uid) do update set pair=excluded.pair,direction=excluded.direction,status=excluded.status,result=excluded.result,pnl_usd=excluded.pnl_usd,pnl_pct=excluded.pnl_pct,entry_price=excluded.entry_price,exit_price=excluded.exit_price,deposit=excluded.deposit,leverage=excluded.leverage,stop_loss=excluded.stop_loss,take_profit=excluded.take_profit,
    payload=coalesce(public.trades.payload,'{}'::jsonb)||excluded.payload||jsonb_build_object('journal',coalesce(public.trades.payload->'journal','{}'::jsonb)||coalesce(excluded.payload->'journal','{}'::jsonb))
   where public.trades.status='open' or excluded.status='closed';
  end loop;
  update public.okx_connections set lease=null,lease_until=null,last_sync_at=now_at,last_error=null,counts=value->'counts' where user_id=owner;
  return 'true'::jsonb;
 end if;
 raise exception 'Unknown operation';
end $$;
revoke all on function public.okx_journal_service(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.okx_journal_service(text,uuid,jsonb) to service_role;

-- Browser roles must not read HTTP request bodies containing the cron authentication token.
revoke all on net.http_request_queue from anon,authenticated;
revoke all on net._http_response from anon,authenticated;
do $$ begin
 if not exists(select 1 from vault.secrets where name='okx_journal_cron') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'okx_journal_cron','Authenticate the journal background reconciliation');
 end if;
end $$;
select cron.schedule('okx-journal-sync','* * * * *',$cron$
 delete from vault.secrets where name like 'okx_connection_%' and not exists(select 1 from public.okx_connections c where c.secret_id=vault.secrets.id);
 select net.http_post(url:='https://www.orbitum.trade/api/okx',headers:='{"Content-Type":"application/json"}'::jsonb,
  body:=jsonb_build_object('action','cron','token',(select decrypted_secret from vault.decrypted_secrets where name='okx_journal_cron')),timeout_milliseconds:=60000)
 where exists(select 1 from public.okx_connections where enabled and (last_sync_at is null or last_sync_at<now()-interval '45 seconds') and (lease_until is null or lease_until<now()));
$cron$);
