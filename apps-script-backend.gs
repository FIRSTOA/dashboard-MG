/**
 * 개인+팀 업무 대시보드 — 로그인/승인/팀 공유 백엔드 (Google Apps Script)
 * ==================================================================
 * 이 스크립트가 대시보드를 "직접 서빙"하고, 구글 로그인으로 사용자를 식별하며,
 * 관리자 승인 + 팀(A/B/C/D)별 데이터 공유를 처리합니다.
 *
 * ▣ 설치 (관리자가 한 번만)
 *   1. 회사 구글계정(admin@firstoa-ai.com)으로 새 구글 시트 생성
 *   2. [확장 프로그램] → [Apps Script] → 이 코드 전체 붙여넣기 → 저장
 *   3. 아래 CONFIG 의 GITHUB_RAW_URL / ADMIN_EMAILS / ALLOWED_DOMAIN 확인
 *   4. [배포] → [새 배포] → 유형 [웹 앱]
 *        - 실행 계정:  "나"
 *        - 액세스 권한: "firstoa-ai.com 내 모든 사용자"  (회사 도메인)
 *      ※ 회사 Workspace가 아니면 "Google 계정이 있는 모든 사용자" 선택
 *   5. 배포 → 권한 승인 → 생성된 /exec URL 을 직원들에게 공유(북마크)
 *   6. 직원이 그 URL로 접속 → 구글 로그인 → "승인 대기"
 *      관리자가 대시보드 우측 상단 🛡️ 관리자 패널에서 승인 + 팀 지정
 *
 * ※ index.html(코드)은 GitHub에서 그대로 수정하면 됩니다.
 *   이 백엔드가 접속 시마다 GitHub의 최신 index.html을 가져와 서빙합니다.
 *   백엔드 코드 자체를 바꿨을 때만 [배포 관리]→[새 버전]으로 재배포하세요.
 */

// ===================== CONFIG =====================
var GITHUB_RAW_URL = 'https://raw.githubusercontent.com/FIRSTOA/dashboard-MG/main/index.html';
var ADMIN_EMAILS   = ['admin@firstoa-ai.com'];
var ALLOWED_DOMAIN = 'firstoa-ai.com'; // '' 이면 도메인 제한 없음
var TEAMS          = ['A', 'B', 'C', 'D'];

var USERS_SHEET = 'Users';
var DATA_SHEET  = 'Data';
var CHUNK_SIZE  = 40000;

// ===================== 진입점: 대시보드 서빙 =====================
function doGet(e) {
  var email = getEmail_();
  if (email) ensureUser_(email);
  var html;
  try {
    html = UrlFetchApp.fetch(GITHUB_RAW_URL, { muteHttpExceptions: true }).getContentText();
  } catch (err) {
    return HtmlService.createHtmlOutput('<h2>대시보드를 불러오지 못했습니다.</h2><p>' + err + '</p>');
  }
  var boot = buildBoot_(email);
  var inject = '<script>window.__BOOT__=' + JSON.stringify(boot) + ';<\/script>';
  if (html.indexOf('</head>') >= 0) html = html.replace('</head>', inject + '\n</head>');
  else html = inject + html;
  return HtmlService.createHtmlOutput(html)
    .setTitle('업무 대시보드')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ===================== 사용자/인증 =====================
function getEmail_() {
  var e = '';
  try { e = Session.getActiveUser().getEmail(); } catch (x) {}
  if (!e) { try { e = Session.getEffectiveUser().getEmail(); } catch (x) {} }
  return e || '';
}
function isAdmin_(email) {
  if (!email) return false;
  return ADMIN_EMAILS.map(function (s) { return s.toLowerCase(); }).indexOf(email.toLowerCase()) >= 0;
}
function usersSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(USERS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(USERS_SHEET);
    sh.appendRow(['email', 'name', 'team', 'status', 'role', 'updatedAt']);
  }
  return sh;
}
function findUserRow_(email) {
  var sh = usersSheet_();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).toLowerCase() === email.toLowerCase()) {
      return { row: i + 1, data: values[i] };
    }
  }
  return null;
}
function ensureUser_(email) {
  if (!email) return;
  var found = findUserRow_(email);
  if (found) {
    // 관리자 이메일은 항상 승인/관리자 권한 보정
    if (isAdmin_(email) && (found.data[3] !== 'approved' || found.data[4] !== 'admin')) {
      var sh0 = usersSheet_();
      sh0.getRange(found.row, 4, 1, 2).setValues([['approved', 'admin']]);
    }
    return;
  }
  var sh = usersSheet_();
  var admin = isAdmin_(email);
  var name = email.split('@')[0];
  sh.appendRow([email, name, '', admin ? 'approved' : 'pending', admin ? 'admin' : 'member', new Date()]);
}
function getUser_(email) {
  var f = findUserRow_(email);
  if (!f) return null;
  return { email: f.data[0], name: f.data[1] || f.data[0].split('@')[0], team: f.data[2] || '', status: f.data[3] || 'pending', role: f.data[4] || 'member' };
}
function approvedMembers_(team) {
  var sh = usersSheet_();
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][3]) === 'approved' && String(values[i][2]) === team && team) {
      out.push({ email: values[i][0], name: values[i][1] || String(values[i][0]).split('@')[0] });
    }
  }
  return out;
}
function buildBoot_(email) {
  if (!email) {
    return { ok: true, loggedIn: false, allowedDomain: ALLOWED_DOMAIN, teams: TEAMS };
  }
  var domainOk = !ALLOWED_DOMAIN || email.toLowerCase().indexOf('@' + ALLOWED_DOMAIN.toLowerCase()) >= 0;
  var u = getUser_(email) || { email: email, name: email.split('@')[0], team: '', status: 'pending', role: 'member' };
  return {
    ok: true, loggedIn: true, email: u.email, name: u.name, team: u.team,
    status: domainOk ? u.status : 'denied', role: u.role, isAdmin: isAdmin_(email),
    teams: TEAMS, allowedDomain: ALLOWED_DOMAIN,
    members: u.status === 'approved' ? approvedMembers_(u.team) : []
  };
}

// google.script.run 으로 호출되는 API
function apiBoot() { return buildBoot_(getEmail_()); }

// ===================== 접근 권한 =====================
// scope 형식: 'priv:<email>' | 'share:<email>' | 'team:<TEAM>'
function canAccess_(email, scope, write) {
  if (!email) return false;
  var me = getUser_(email);
  if (!me || me.status !== 'approved') return false;
  var admin = isAdmin_(email);
  var parts = scope.split(':');
  var kind = parts[0], who = parts.slice(1).join(':');
  if (kind === 'priv') return admin || who.toLowerCase() === email.toLowerCase();
  if (kind === 'share') {
    if (admin || who.toLowerCase() === email.toLowerCase()) return true;
    if (write) return false; // 남의 공유 데이터는 보기 전용
    var other = getUser_(who);
    return !!(other && other.status === 'approved' && other.team && other.team === me.team);
  }
  if (kind === 'team') return admin || (me.team && me.team === who);
  return false;
}

// ===================== 데이터 저장 (스코프별, 청크 분할) =====================
function dataSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(DATA_SHEET);
  if (!sh) { sh = ss.insertSheet(DATA_SHEET); sh.appendRow(['scope', 'chunkIndex', 'data', 'updatedAt']); }
  return sh;
}
function readScopeRaw_(scope) {
  var sh = dataSheet_();
  var values = sh.getDataRange().getValues();
  var chunks = [];
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === scope) chunks.push({ idx: Number(values[i][1]) || 0, data: String(values[i][2] || '') });
  }
  if (!chunks.length) return {};
  chunks.sort(function (a, b) { return a.idx - b.idx; });
  try { return JSON.parse(chunks.map(function (c) { return c.data; }).join('')); } catch (e) { return {}; }
}
function writeScopeRaw_(scope, dataObj) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = dataSheet_();
    var values = sh.getDataRange().getValues();
    for (var i = values.length - 1; i >= 1; i--) {
      if (String(values[i][0]) === scope) sh.deleteRow(i + 1);
    }
    var jsonStr = JSON.stringify(dataObj);
    var now = new Date();
    var rows = [];
    for (var p = 0; p < jsonStr.length; p += CHUNK_SIZE) rows.push([scope, rows.length, jsonStr.substring(p, p + CHUNK_SIZE), now]);
    if (rows.length === 0) rows.push([scope, 0, '{}', now]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  } finally { lock.releaseLock(); }
}
function apiLoad(scope) {
  var email = getEmail_();
  if (!canAccess_(email, scope, false)) return { ok: false, error: 'forbidden' };
  return { ok: true, data: readScopeRaw_(scope) };
}
function apiSave(scope, jsonStr) {
  var email = getEmail_();
  if (!canAccess_(email, scope, true)) return { ok: false, error: 'forbidden' };
  var obj; try { obj = JSON.parse(jsonStr); } catch (e) { return { ok: false, error: 'bad json' }; }
  writeScopeRaw_(scope, obj);
  return { ok: true };
}

// ===================== 관리자 API =====================
function requireAdmin_() {
  var email = getEmail_();
  if (!isAdmin_(email)) throw new Error('관리자 전용입니다.');
  return email;
}
function apiAdminListUsers() {
  requireAdmin_();
  var sh = usersSheet_();
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    out.push({ email: values[i][0], name: values[i][1], team: values[i][2] || '', status: values[i][3] || 'pending', role: values[i][4] || 'member' });
  }
  return { ok: true, users: out, teams: TEAMS };
}
function apiAdminUpdateUser(email, team, status, role) {
  requireAdmin_();
  var f = findUserRow_(email);
  if (!f) return { ok: false, error: 'not found' };
  var sh = usersSheet_();
  sh.getRange(f.row, 2, 1, 5).setValues([[f.data[1], team || '', status || 'pending', role || 'member', new Date()]]);
  return { ok: true };
}
function apiAdminRemoveUser(email) {
  requireAdmin_();
  var f = findUserRow_(email);
  if (!f) return { ok: false };
  usersSheet_().deleteRow(f.row);
  return { ok: true };
}
