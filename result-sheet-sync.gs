/**
 * 분기목표 결과표 ↔ 대시보드 양방향 연동 (Google Apps Script)
 * ============================================================
 * "결과표" 탭의  A:구분  B:목표  K:4월  L:5월  M:6월  을
 * 대시보드로 읽어오고, 대시보드에서 4·5·6월을 수정하면 시트에 바로 기록합니다.
 *
 * ▣ 설치 (해당 스프레드시트에서 1회)
 *   1. 연동할 스프레드시트 열기(결과표 탭이 있는 그 파일)
 *      → [확장 프로그램] → [Apps Script]
 *   2. 이 코드 전체 붙여넣기 → 저장
 *   3. 아래 CONFIG(탭이름/시작행/열 번호)가 실제 시트와 맞는지 확인
 *   4. [배포] → [새 배포] → 유형 [웹 앱]
 *        - 실행 계정:  "나"
 *        - 액세스 권한: "모든 사용자"
 *   5. 배포 → 권한 승인 → 생성된 /exec URL 복사 → 채팅으로 알려주세요
 *      (대시보드 분기목표 화면 [🔗 결과표 연동]에 입력)
 *
 * ※ 테스트: 브라우저에서  <exec주소>?action=goals  를 열면 읽어온 JSON이 보입니다.
 */

// ===================== CONFIG =====================
var TAB_NAME = '결과표';     // 탭(시트) 이름
var START_ROW = 1;          // 1부터 읽되 머리글/제목 행은 자동으로 건너뜀
var COL = {
  gubun: 1,   // A열 = 구분
  goal:  2,   // B열 = 목표
  j:    10,   // J열 = 구분 복사본 (A와 같게 자동 채움)
  m4:   11,   // K열 = 4월
  m5:   12,   // L열 = 5월
  m6:   13    // M열 = 6월
};
// ==================================================

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'goals';
  var gid = (e && e.parameter && e.parameter.gid) || '';
  if (action === 'goals') return json_(readGoals_(gid, e.parameter.goalCol, e.parameter.noMonths));
  if (action === 'tabs') return json_(listTabs_());
  if (action === 'card') return json_(readCard_(gid, e.parameter.quarter));
  return json_({ ok: true, msg: '결과표 연동 정상 작동 중' });
}

// 모든 탭(시트) 이름·gid 목록 — 계획표 등 탭 자동 인식용
function listTabs_() {
  var shs = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  return { ok: true, tabs: shs.map(function (s) { return { name: s.getName(), gid: String(s.getSheetId()) }; }) };
}

// gid(시트ID)로 탭 찾기. 없으면 기본 TAB_NAME 사용
function getSheet_(gid) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (gid) {
    var shs = ss.getSheets();
    for (var i = 0; i < shs.length; i++) {
      if (String(shs[i].getSheetId()) === String(gid)) return shs[i];
    }
  }
  return ss.getSheetByName(TAB_NAME);
}

function readGoals_(gid, goalColParam, noMonths) {
  var sh = getSheet_(gid);
  if (!sh) return { ok: false, error: '탭을 찾을 수 없습니다 (gid: ' + (gid || TAB_NAME) + ')' };
  var goalCol = Number(goalColParam) || COL.goal; // 계획표: C(3)=기본업무, I(9)=미션업무
  var skipMonths = String(noMonths || '') === '1';
  var last = sh.getLastRow();
  if (last < START_ROW) return { ok: true, months: [], rows: [] };
  var n = last - START_ROW + 1;
  var lastCol = Math.max(13, sh.getLastColumn());
  var values = sh.getRange(START_ROW, 1, n, lastCol).getValues();
  var rich = sh.getRange(START_ROW, 1, n, lastCol).getRichTextValues();

  // 1) 월 머리글 행 자동 탐지 ('4월','5월'… 또는 '7월','8월'… 분기 바뀌어도 자동 인식)
  var monthCols = [];
  if (!skipMonths) {
    for (var h = 0; h < n; h++) {
      var found = [];
      for (var c = 0; c < lastCol; c++) {
        var hv = String(values[h][c] || '').trim();
        if (/^\d{1,2}\s*월$/.test(hv)) found.push({ col: c + 1, label: hv.replace(/\s/g, '') });
      }
      if (found.length >= 2) { monthCols = found; break; }
    }
    if (!monthCols.length) monthCols = [{ col: 11, label: '4월' }, { col: 12, label: '5월' }, { col: 13, label: '6월' }];
  }

  // 1.5) 월 컬럼이 가로로 병합된 행 탐지(통합 표시용)
  var mergedRows = {};
  if (monthCols.length >= 2) {
    var firstC = monthCols[0].col, cnt = monthCols.length;
    try {
      sh.getRange(START_ROW, firstC, n, cnt).getMergedRanges().forEach(function (rng) {
        if (rng.getNumColumns() >= cnt) {
          for (var rr = rng.getRow(); rr < rng.getRow() + rng.getNumRows(); rr++) mergedRows[rr] = true;
        }
      });
    } catch (e) {}
  }

  // 2) 데이터 행
  var rows = [];
  var lastGubun = '';
  for (var i = 0; i < n; i++) {
    var gubun = String(values[i][COL.gubun - 1] || '').trim();
    var goal = String(values[i][goalCol - 1] || '').trim();
    var gN = gubun.replace(/\s/g, ''), goN = goal.replace(/\s/g, ''); // '구 분','목 표' 등 띄어쓰기 무시
    if (gN === '구분' || goN === '목표' || goN === '구분' || goN === '목 표') continue;
    if (/^\d{4}\s*년?\s*\d?\s*분기$/.test(goN)) continue;
    var isMonthHeader = monthCols.some(function (mc) { return String(values[i][mc.col - 1] || '').trim() === mc.label; });
    if (isMonthHeader) continue;
    if (gubun) lastGubun = gubun;
    if (goal === '') continue;
    var months = monthCols.map(function (mc) {
      return { col: mc.col, label: mc.label, text: String(values[i][mc.col - 1] || '') }; // 월칸은 그냥 텍스트(검정)
    });
    rows.push({
      row: START_ROW + i,
      gubun: gubun || lastGubun,
      goal: goal,
      goalCol: goalCol,
      goalHtml: cellHtml_(rich[i][goalCol - 1]), // 목표: 줄바꿈+색상 유지
      months: months,
      merged: !!mergedRows[START_ROW + i]         // 월 셀 통합(병합) 여부
    });
  }
  return { ok: true, months: monthCols.map(function (m) { return m.label; }), rows: rows };
}

function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents || '{}');
    var sh = getSheet_(b.gid);
    if (!sh) return json_({ ok: false, error: '탭 없음 (gid: ' + (b.gid || TAB_NAME) + ')' });

    if (b.action === 'update') {
      // 한 셀(특정 행/열) 수정 — 열 번호로 지정(월 컬럼 자동대응)
      var col = Number(b.col) || ({ m4: COL.m4, m5: COL.m5, m6: COL.m6 })[b.field];
      if (!col || !b.row) return json_({ ok: false, error: 'bad params' });
      sh.getRange(Number(b.row), col).setValue(b.value == null ? '' : b.value);
      return json_({ ok: true });
    }

    if (b.action === 'mergeMonths') {
      // 한 행의 월 칸들을 가로로 통합(병합)
      var mc = Number(b.col), mcnt = Number(b.count);
      if (!b.row || !mc || mcnt < 2) return json_({ ok: false, error: 'bad params' });
      var rng = sh.getRange(Number(b.row), mc, 1, mcnt);
      rng.breakApart();    // 이미 일부 병합돼 있으면 먼저 해제
      rng.mergeAcross();   // 좌측 값 유지하며 가로 병합
      return json_({ ok: true });
    }
    if (b.action === 'unmergeMonths') {
      // 통합 해제 → 다시 월별로
      var uc = Number(b.col), ucnt = Number(b.count);
      if (!b.row || !uc || ucnt < 2) return json_({ ok: false, error: 'bad params' });
      sh.getRange(Number(b.row), uc, 1, ucnt).breakApart();
      return json_({ ok: true });
    }
    if (b.action === 'addRow') {
      // 특정 행 바로 아래에 새 목표 행 삽입(서식 복사) + 구분/목표 세팅
      var after = Number(b.afterRow);
      if (!after) return json_({ ok: false, error: 'bad params' });
      sh.insertRowAfter(after);
      sh.getRange(after + 1, COL.gubun).setValue(b.gubun || '');
      sh.getRange(after + 1, COL.goal).setValue(b.goal || '새 목표');
      return json_({ ok: true, row: after + 1 });
    }
    if (b.action === 'deleteRow') {
      var dr = Number(b.row);
      if (!dr) return json_({ ok: false, error: 'bad params' });
      sh.deleteRow(dr);
      return json_({ ok: true });
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// 셀의 서식(글자색)을 HTML로 변환 (줄바꿈은 <br>)
function cellHtml_(rt) {
  if (!rt) return '';
  var runs;
  try { runs = rt.getRuns(); } catch (e) { return esc_(String(rt.getText ? rt.getText() : '')).replace(/\n/g, '<br>'); }
  var html = '';
  runs.forEach(function (run) {
    var t = run.getText();
    if (t === '') return;
    var color = null;
    try { color = run.getTextStyle().getForegroundColor(); } catch (e) {}
    var safe = esc_(t).replace(/\n/g, '<br>');
    if (color && color.toLowerCase() !== '#000000') html += '<span style="color:' + color + '">' + safe + '</span>';
    else html += safe;
  });
  return html;
}
function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ===================== 골든미팅카드 (분기 × 질문4 × 카테고리6) =====================
// 주의: 위에서부터 검사하므로, 더 구체적인 q2(기여)를 q1(성과)보다 먼저 둠
// ("타인의 성과에 내가 기여한" 에도 '성과'가 있어 q1으로 잘못 잡히던 문제 방지)
var CARD_QUESTIONS = [
  { key: 'q2', label: '타인의 성과에 내가 기여한 것은?', kw: ['기여'] },
  { key: 'q3', label: '성장을 위한 학습 & 발견한 지식', kw: ['학습', '발견'] },
  { key: 'q4', label: '다음 도전을 위한 지원 요청', kw: ['지원', '도전'] },
  { key: 'q1', label: '지난기간 나의 성과는?', kw: ['지난기간', '나의성과', '나의 성과', '성과'] }
];
// 화면 표시 순서(q1→q4)
var CARD_Q_ORDER = ['q1', 'q2', 'q3', 'q4'];
var CARD_CATS = [
  { key: '매출', label: '매출증대·안정', kw: ['매출'] },
  { key: '효율', label: '효율성', kw: ['효율'] },
  { key: '비용', label: '비용절감', kw: ['비용'] },
  { key: '자기', label: '자기개발', kw: ['자기개발'] },
  { key: '소통', label: '소통', kw: ['소통'] },
  { key: 'AI',  label: 'AI', kw: ['AI'] }
];
function qOf_(text) {
  var t = String(text || '');
  for (var i = 0; i < CARD_QUESTIONS.length; i++) {
    var kw = CARD_QUESTIONS[i].kw;
    for (var k = 0; k < kw.length; k++) if (t.indexOf(kw[k]) >= 0) return CARD_QUESTIONS[i];
  }
  return null;
}
function quarterOf_(text) {
  var t = String(text || '').replace(/\s/g, '');
  var m = t.match(/([1-4])\s*[Qq]/) || t.match(/([1-4])\s*분기/);
  return m ? m[1] : '';
}

function readCard_(gid, quarter) {
  var sh = getSheet_(gid);
  if (!sh) return { ok: false, error: '탭을 찾을 수 없습니다 (gid: ' + gid + ')' };
  quarter = String(quarter || '').replace(/[^1-4]/g, '') || '2';
  var lastRow = sh.getLastRow(), lastCol = Math.max(10, sh.getLastColumn());
  if (lastRow < 1) return { ok: true, quarter: quarter, questions: [] };
  var vals = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var rich = sh.getRange(1, 1, lastRow, lastCol).getRichTextValues();

  // 1) 카테고리 헤더행/열 자동 탐지 (6개 중 3개 이상이 서로 다른 열에 있는 행)
  var catCols = null;
  for (var r = 0; r < Math.min(lastRow, 40); r++) {
    var found = {}, cnt = 0;
    for (var c = 0; c < lastCol; c++) {
      var cell = String(vals[r][c] || '');
      for (var ci = 0; ci < CARD_CATS.length; ci++) {
        if (found[CARD_CATS[ci].key]) continue;
        var ok = true; var kw = CARD_CATS[ci].kw;
        for (var kk = 0; kk < kw.length; kk++) if (cell.indexOf(kw[kk]) < 0) ok = false;
        // 카테고리 헤더 셀은 짧음(데이터와 구분) — 60자 이하만 헤더로 인정
        if (ok && cell.replace(/\s/g, '').length <= 60) { found[CARD_CATS[ci].key] = c + 1; cnt++; }
      }
    }
    if (cnt >= 3) { catCols = found; break; }
  }
  if (!catCols) { // 못 찾으면 기본값 C~H (3~8)
    catCols = { '매출': 3, '효율': 4, '비용': 5, '자기': 6, '소통': 7, 'AI': 8 };
  }

  // 2) 질문 행 찾기 + 분기 추적(병합셀: A열 비면 위 분기 유지)
  var curQ = '';
  var questions = [];
  var seen = {};
  for (var r2 = 0; r2 < lastRow; r2++) {
    var aCell = '';
    for (var ac = 0; ac < 2; ac++) { var qv = quarterOf_(vals[r2][ac]); if (qv) { aCell = qv; break; } }
    if (aCell) curQ = aCell;
    if (curQ !== quarter) continue;
    var qInfo = qOf_(vals[r2][1]) || qOf_(vals[r2][0]);
    if (!qInfo || seen[qInfo.key]) continue;
    seen[qInfo.key] = true;
    var cells = CARD_CATS.map(function (cat) {
      var col = catCols[cat.key] || 0;
      return {
        cat: cat.label, col: col,
        text: col ? String(vals[r2][col - 1] || '') : '',
        html: col ? cellHtml_(rich[r2][col - 1]) : ''
      };
    });
    questions.push({ key: qInfo.key, label: qInfo.label, row: r2 + 1, cells: cells });
  }
  questions.sort(function (a, b) { return CARD_Q_ORDER.indexOf(a.key) - CARD_Q_ORDER.indexOf(b.key); });
  return { ok: true, quarter: quarter, questions: questions };
}
