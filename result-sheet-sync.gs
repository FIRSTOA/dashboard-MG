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
  if (action === 'goals') {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_NAME);
    if (sh) { try { fillJfromA_(sh); } catch (x) {} } // J = A 자동 채움
    return json_(readGoals_());
  }
  return json_({ ok: true, msg: '결과표 연동 정상 작동 중' });
}

function readGoals_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_NAME);
  if (!sh) return { ok: false, error: '탭을 찾을 수 없습니다: ' + TAB_NAME };
  var last = sh.getLastRow();
  if (last < START_ROW) return { ok: true, months: [], rows: [] };
  var n = last - START_ROW + 1;
  var lastCol = Math.max(13, sh.getLastColumn());
  var values = sh.getRange(START_ROW, 1, n, lastCol).getValues();
  var rich = sh.getRange(START_ROW, 1, n, lastCol).getRichTextValues();

  // 1) 월 머리글 행 자동 탐지 ('4월','5월'… 또는 '7월','8월'… 분기 바뀌어도 자동 인식)
  var monthCols = [];
  for (var h = 0; h < n; h++) {
    var found = [];
    for (var c = 0; c < lastCol; c++) {
      var hv = String(values[h][c] || '').trim();
      if (/^\d{1,2}\s*월$/.test(hv)) found.push({ col: c + 1, label: hv.replace(/\s/g, '') });
    }
    if (found.length >= 2) { monthCols = found; break; }
  }
  if (!monthCols.length) monthCols = [{ col: 11, label: '4월' }, { col: 12, label: '5월' }, { col: 13, label: '6월' }];

  // 2) 데이터 행
  var rows = [];
  var lastGubun = '';
  for (var i = 0; i < n; i++) {
    var gubun = String(values[i][COL.gubun - 1] || '').trim();
    var goal = String(values[i][COL.goal - 1] || '').trim();
    if (gubun === '구분' || goal === '목표' || goal === '구분') continue;
    if (/^\d{4}\s*년?\s*\d?\s*분기$/.test(goal)) continue;
    var isMonthHeader = monthCols.some(function (mc) { return String(values[i][mc.col - 1] || '').trim() === mc.label; });
    if (isMonthHeader) continue;
    if (gubun) lastGubun = gubun;
    if (goal === '') continue;
    var months = monthCols.map(function (mc) {
      return {
        col: mc.col, label: mc.label,
        text: String(values[i][mc.col - 1] || ''),
        html: cellHtml_(rich[i][mc.col - 1])
      };
    });
    rows.push({ row: START_ROW + i, gubun: gubun || lastGubun, goal: goal, months: months });
  }
  return { ok: true, months: monthCols.map(function (m) { return m.label; }), rows: rows };
}

// A(구분)를 J열에도 같게 채움 (병합셀은 위 값 이어받아 내려 채움)
function fillJfromA_(sh) {
  var last = sh.getLastRow();
  if (last < START_ROW) return;
  var n = last - START_ROW + 1;
  var aVals = sh.getRange(START_ROW, COL.gubun, n, 1).getValues();
  var out = [];
  var lastG = '';
  for (var i = 0; i < n; i++) {
    var v = String(aVals[i][0] || '').trim();
    if (v) lastG = v;
    out.push([lastG]);
  }
  sh.getRange(START_ROW, COL.j, n, 1).setValues(out);
}

function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents || '{}');
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_NAME);
    if (!sh) return json_({ ok: false, error: '탭 없음: ' + TAB_NAME });

    if (b.action === 'update') {
      // 한 셀(특정 행/열) 수정 — 열 번호로 지정(월 컬럼 자동대응)
      var col = Number(b.col) || ({ m4: COL.m4, m5: COL.m5, m6: COL.m6 })[b.field];
      if (!col || !b.row) return json_({ ok: false, error: 'bad params' });
      sh.getRange(Number(b.row), col).setValue(b.value == null ? '' : b.value);
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
