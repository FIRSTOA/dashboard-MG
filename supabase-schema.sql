-- ============================================================
-- 업무 대시보드 — Supabase 스키마 (이름 ID + 비밀번호 / 관리자 계정 생성)
-- ============================================================
-- ▣ 설치 (관리자가 한 번만)
--   1. https://supabase.com 에서 새 프로젝트 생성 (무료)
--   2. 좌측 [SQL Editor] → 이 파일 전체 붙여넣기 → RUN
--   3. 맨 아래 "최초 관리자 계정" 블록의 비밀번호를 바꿔서 한 번 더 실행
--   4. [Project Settings] → [API] 에서 Project URL 과 anon public key 복사
--   5. index.html 상단 SUPABASE_URL / SUPABASE_ANON_KEY 에 붙여넣기
--      (anon key 는 공개돼도 안전 — 모든 접근은 아래 함수 + 토큰으로만 가능)
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 테이블 ----------
create table if not exists accounts (
  id         uuid primary key default gen_random_uuid(),
  username   text unique not null,
  pwhash     text not null,
  team       text default '',
  role       text default 'member',          -- 'member' | 'admin'
  created_at timestamptz default now()
);

create table if not exists sessions (
  token      uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  created_at timestamptz default now(),
  expires_at timestamptz default now() + interval '30 days'
);

create table if not exists kv (
  scope      text primary key,               -- 'priv:<username>' | 'share:<username>' | 'team:<TEAM>'
  data       jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- 직접 접근 전면 차단(정책 없음) → 오직 아래 SECURITY DEFINER 함수로만 접근
alter table accounts enable row level security;
alter table sessions enable row level security;
alter table kv       enable row level security;

-- ---------- 내부 헬퍼: 토큰 → 계정 ----------
create or replace function _acct(p_token uuid)
returns accounts language sql security definer set search_path = public, pg_temp stable as $$
  select a.* from accounts a
  join sessions s on s.account_id = a.id
  where s.token = p_token and s.expires_at > now()
$$;

-- ---------- 로그인 / 세션 ----------
create or replace function app_login(p_username text, p_pw text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare a accounts; t uuid;
begin
  select * into a from accounts where lower(username) = lower(p_username);
  if a.id is null or a.pwhash <> crypt(p_pw, a.pwhash) then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;
  delete from sessions where expires_at < now();
  insert into sessions(account_id) values (a.id) returning token into t;
  return json_build_object('ok', true, 'token', t,
    'username', a.username, 'team', a.team, 'role', a.role,
    'members', members_of_(a.team));
end $$;

create or replace function members_of_(p_team text)
returns json language sql security definer set search_path = public, pg_temp stable as $$
  select coalesce(json_agg(json_build_object('username', username) order by username), '[]'::json)
  from accounts where p_team <> '' and team = p_team
$$;

create or replace function app_me(p_token uuid)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare a accounts;
begin
  select * into a from _acct(p_token);
  if a.id is null then return json_build_object('ok', false); end if;
  return json_build_object('ok', true, 'username', a.username, 'team', a.team, 'role', a.role,
    'isAdmin', a.role = 'admin', 'members', members_of_(a.team));
end $$;

create or replace function app_logout(p_token uuid)
returns json language sql security definer set search_path = public, pg_temp as $$
  delete from sessions where token = p_token;
  select json_build_object('ok', true);
$$;

-- 본인 비밀번호 변경
create or replace function app_change_pw(p_token uuid, p_old text, p_new text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare a accounts;
begin
  select * into a from _acct(p_token);
  if a.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if a.pwhash <> crypt(p_old, a.pwhash) then return json_build_object('ok', false, 'error', 'wrongpw'); end if;
  update accounts set pwhash = crypt(p_new, gen_salt('bf')) where id = a.id;
  return json_build_object('ok', true);
end $$;

-- ---------- 데이터 로드/저장 (스코프 + 권한) ----------
create or replace function app_load(p_token uuid, p_scope text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare me accounts; kind text; who text; ok boolean := false; d jsonb;
begin
  select * into me from _acct(p_token);
  if me.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  kind := split_part(p_scope, ':', 1);
  who  := substr(p_scope, length(kind) + 2);
  if kind = 'priv' then
    ok := (me.role = 'admin' or lower(who) = lower(me.username));
  elsif kind = 'team' then
    ok := (me.role = 'admin' or (me.team <> '' and me.team = who));
  elsif kind = 'share' then
    if me.role = 'admin' or lower(who) = lower(me.username) then ok := true;
    else ok := exists(select 1 from accounts o where lower(o.username) = lower(who) and o.team = me.team and me.team <> '');
    end if;
  end if;
  if not ok then return json_build_object('ok', false, 'error', 'forbidden'); end if;
  select data into d from kv where scope = p_scope;
  return json_build_object('ok', true, 'data', coalesce(d, '{}'::jsonb));
end $$;

create or replace function app_save(p_token uuid, p_scope text, p_data jsonb)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare me accounts; kind text; who text; ok boolean := false;
begin
  select * into me from _acct(p_token);
  if me.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  kind := split_part(p_scope, ':', 1);
  who  := substr(p_scope, length(kind) + 2);
  if kind = 'priv' then
    ok := (lower(who) = lower(me.username));
  elsif kind = 'team' then
    ok := (me.team <> '' and me.team = who);     -- 팀원 누구나 팀 보드 수정
  elsif kind = 'share' then
    ok := (lower(who) = lower(me.username));      -- 공유 데이터는 본인만 수정
  end if;
  if not ok then return json_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into kv(scope, data, updated_at) values (p_scope, p_data, now())
    on conflict (scope) do update set data = excluded.data, updated_at = now();
  return json_build_object('ok', true);
end $$;

-- ---------- 관리자 ----------
create or replace function _is_admin(p_token uuid)
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select coalesce((select role = 'admin' from _acct(p_token)), false)
$$;

create or replace function app_admin_list(p_token uuid)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not _is_admin(p_token) then return json_build_object('ok', false, 'error', 'forbidden'); end if;
  return json_build_object('ok', true,
    'users', (select coalesce(json_agg(json_build_object('username', username, 'team', team, 'role', role) order by username), '[]')
              from accounts));
end $$;

create or replace function app_admin_create(p_token uuid, p_username text, p_pw text, p_team text, p_role text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not _is_admin(p_token) then return json_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce(p_username,'') = '' or coalesce(p_pw,'') = '' then return json_build_object('ok', false, 'error', 'empty'); end if;
  if exists(select 1 from accounts where lower(username) = lower(p_username)) then
    return json_build_object('ok', false, 'error', 'exists');
  end if;
  insert into accounts(username, pwhash, team, role)
  values (p_username, crypt(p_pw, gen_salt('bf')), coalesce(p_team, ''), coalesce(p_role, 'member'));
  return json_build_object('ok', true);
end $$;

create or replace function app_admin_update(p_token uuid, p_username text, p_team text, p_role text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not _is_admin(p_token) then return json_build_object('ok', false, 'error', 'forbidden'); end if;
  update accounts set team = coalesce(p_team, ''), role = coalesce(p_role, 'member') where lower(username) = lower(p_username);
  return json_build_object('ok', true);
end $$;

create or replace function app_admin_resetpw(p_token uuid, p_username text, p_pw text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not _is_admin(p_token) then return json_build_object('ok', false, 'error', 'forbidden'); end if;
  update accounts set pwhash = crypt(p_pw, gen_salt('bf')) where lower(username) = lower(p_username);
  return json_build_object('ok', true);
end $$;

create or replace function app_admin_delete(p_token uuid, p_username text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare me accounts;
begin
  select * into me from _acct(p_token);
  if me.id is null or me.role <> 'admin' then return json_build_object('ok', false, 'error', 'forbidden'); end if;
  if lower(p_username) = lower(me.username) then return json_build_object('ok', false, 'error', 'self'); end if;
  delete from accounts where lower(username) = lower(p_username);
  return json_build_object('ok', true);
end $$;

-- ---------- 실행 권한 (anon 키로 호출 허용) ----------
grant execute on function
  app_login(text, text), app_me(uuid), app_logout(uuid), app_change_pw(uuid, text, text),
  app_load(uuid, text), app_save(uuid, text, jsonb),
  app_admin_list(uuid), app_admin_create(uuid, text, text, text, text),
  app_admin_update(uuid, text, text, text), app_admin_resetpw(uuid, text, text),
  app_admin_delete(uuid, text)
to anon, authenticated;

-- ============================================================
-- 최초 관리자 계정 (비밀번호를 바꿔서 한 번 실행하세요)
--   아이디: admin   /   비밀번호: change-me-1234  (← 반드시 변경)
-- ============================================================
insert into accounts(username, pwhash, team, role)
values ('admin', crypt('change-me-1234', gen_salt('bf')), '', 'admin')
on conflict (username) do nothing;
