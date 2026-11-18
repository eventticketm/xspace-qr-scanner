-- XSpace Gate System: secure scan engine
-- Run in Supabase SQL Editor after confirming the three public tables exist.
-- This script does not insert, delete, or regenerate ticket records.

create or replace function public.process_ticket_scan(p_qr_value text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_ticket_id text;
  v_status text;
  v_action text;
  v_outcome text;
  v_reason text;
  v_message text;
begin
  if v_user_id is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  select sp.role, sp.is_active
    into v_role, v_active
  from public.staff_profiles sp
  where sp.user_id = v_user_id;

  if not found or v_active is distinct from true or v_role not in ('ENTRY', 'EXIT') then
    raise exception 'STAFF_NOT_AUTHORISED';
  end if;

  v_action := v_role;

  if p_qr_value is null or length(btrim(p_qr_value)) = 0 or length(p_qr_value) > 500 then
    insert into public.scan_history
      (ticket_id, scanned_value, action, outcome, reason, staff_user_id)
    values
      (null, coalesce(left(p_qr_value, 500), ''), v_action, 'REJECTED', 'INVALID_QR_VALUE', v_user_id);
    return jsonb_build_object('outcome','REJECTED','reason','INVALID_QR_VALUE','message','Invalid QR value.');
  end if;

  select t.ticket_id, t.status
    into v_ticket_id, v_status
  from public.tickets t
  where t.qr_value = btrim(p_qr_value)
     or t.ticket_id = btrim(p_qr_value)
  limit 1
  for update;

  if not found then
    insert into public.scan_history
      (ticket_id, scanned_value, action, outcome, reason, staff_user_id)
    values
      (null, left(btrim(p_qr_value), 500), v_action, 'REJECTED', 'TICKET_NOT_FOUND', v_user_id);
    return jsonb_build_object('outcome','REJECTED','reason','TICKET_NOT_FOUND','message','Ticket not found.');
  end if;

  if v_action = 'ENTRY' and v_status = 'INSIDE' then
    v_outcome := 'REJECTED';
    v_reason := 'ALREADY_INSIDE';
    v_message := 'ALREADY INSIDE — ACCESS DENIED';
  elsif v_action = 'EXIT' and v_status = 'OUTSIDE' then
    v_outcome := 'REJECTED';
    v_reason := 'ALREADY_OUTSIDE';
    v_message := 'ALREADY OUTSIDE — EXIT NOT REQUIRED';
  else
    v_outcome := 'ACCEPTED';
    v_reason := null;
    if v_action = 'ENTRY' then
      update public.tickets set status = 'INSIDE', updated_at = now() where ticket_id = v_ticket_id;
      v_message := 'ENTRY APPROVED — TICKET MARKED INSIDE';
    else
      update public.tickets set status = 'OUTSIDE', updated_at = now() where ticket_id = v_ticket_id;
      v_message := 'EXIT APPROVED — TICKET MARKED OUTSIDE';
    end if;
  end if;

  insert into public.scan_history
    (ticket_id, scanned_value, action, outcome, reason, staff_user_id)
  values
    (v_ticket_id, left(btrim(p_qr_value), 500), v_action, v_outcome, v_reason, v_user_id);

  return jsonb_build_object(
    'outcome', v_outcome,
    'reason', v_reason,
    'ticket_id', v_ticket_id,
    'status', case when v_outcome = 'ACCEPTED' then (case when v_action = 'ENTRY' then 'INSIDE' else 'OUTSIDE' end) else v_status end,
    'message', v_message
  );
end;
$$;

revoke all on function public.process_ticket_scan(text) from public, anon;
grant execute on function public.process_ticket_scan(text) to authenticated;

create or replace function public.admin_dashboard_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_active boolean;
begin
  select sp.role, sp.is_active into v_role, v_active
  from public.staff_profiles sp where sp.user_id = v_user_id;

  if v_user_id is null or v_role <> 'ADMIN' or v_active is distinct from true then
    raise exception 'ADMIN_NOT_AUTHORISED';
  end if;

  return jsonb_build_object(
    'total_tickets', (select count(*) from public.tickets),
    'inside', (select count(*) from public.tickets where status = 'INSIDE'),
    'outside', (select count(*) from public.tickets where status = 'OUTSIDE'),
    'accepted_scans', (select count(*) from public.scan_history where outcome = 'ACCEPTED'),
    'rejected_scans', (select count(*) from public.scan_history where outcome = 'REJECTED'),
    'active_staff', (select count(*) from public.staff_profiles where is_active = true)
  );
end;
$$;

revoke all on function public.admin_dashboard_summary() from public, anon;
grant execute on function public.admin_dashboard_summary() to authenticated;

create or replace function public.admin_recent_scan_history(p_limit integer default 100)
returns table (
  id bigint,
  ticket_id text,
  scanned_value text,
  action text,
  outcome text,
  reason text,
  staff_email text,
  scanned_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_active boolean;
begin
  select sp.role, sp.is_active into v_role, v_active
  from public.staff_profiles sp where sp.user_id = v_user_id;

  if v_user_id is null or v_role <> 'ADMIN' or v_active is distinct from true then
    raise exception 'ADMIN_NOT_AUTHORISED';
  end if;

  return query
  select h.id, h.ticket_id, h.scanned_value, h.action, h.outcome, h.reason,
         coalesce(sp.email, 'Unknown'), h.scanned_at
  from public.scan_history h
  left join public.staff_profiles sp on sp.user_id = h.staff_user_id
  order by h.scanned_at desc
  limit greatest(1, least(coalesce(p_limit,100),500));
end;
$$;

revoke all on function public.admin_recent_scan_history(integer) from public, anon;
grant execute on function public.admin_recent_scan_history(integer) to authenticated;


create or replace function public.current_staff_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.staff_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;
  select * into v_profile
  from public.staff_profiles
  where user_id = auth.uid();

  if not found or v_profile.is_active is distinct from true then
    raise exception 'STAFF_NOT_ACTIVE';
  end if;

  return jsonb_build_object(
    'user_id', v_profile.user_id,
    'email', v_profile.email,
    'full_name', v_profile.full_name,
    'role', v_profile.role,
    'is_active', v_profile.is_active
  );
end;
$$;

revoke all on function public.current_staff_profile() from public, anon;
grant execute on function public.current_staff_profile() to authenticated;

create or replace function public.admin_ticket_list(p_limit integer default 300)
returns table (ticket_id text, qr_value text, status text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_active boolean;
begin
  select sp.role, sp.is_active into v_role, v_active
  from public.staff_profiles sp where sp.user_id = v_user_id;
  if v_user_id is null or v_role <> 'ADMIN' or v_active is distinct from true then
    raise exception 'ADMIN_NOT_AUTHORISED';
  end if;
  return query
  select t.ticket_id, t.qr_value, t.status, t.updated_at
  from public.tickets t
  order by t.ticket_id
  limit greatest(1, least(coalesce(p_limit,300),1000));
end;
$$;

revoke all on function public.admin_ticket_list(integer) from public, anon;
grant execute on function public.admin_ticket_list(integer) to authenticated;
