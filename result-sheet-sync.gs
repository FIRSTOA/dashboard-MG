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
var START_ROW = 2;          // 데이터가 시작하는 행 (헤더가 1행이면 2)
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
  var rows = [];
  if (last >= START_ROW) {
    var values = sh.getRange(START_ROW, 1, last - START_ROW + 1, 13).getValues();
    var lastGubun = ''; // 병합셀: 구분이 비면 위 값 이어받기
    values.forEach(function (r, i) {
      var gubun = String(r[COL.gubun - 1] || '').trim();
      var goal = String(r[COL.goal - 1] || '').trim();
      if (gubun) lastGubun = gubun;
      if (goal === '') return; // 목표 없는 행(구분만/빈행)은 표시 안 함
      rows.push({
        row: START_ROW + i,
        gubun: gubun || lastGubun, // 병합된 아래 행은 위 구분 사용
        goal: goal,
        m4: String(r[COL.m4 - 1] || ''),
        m5: String(r[COL.m5 - 1] || ''),
        m6: String(r[COL.m6 - 1] || '')
      });
    });
  }
  return { ok: true, rows: rows };
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
      // 한 셀(특정 행의 4/5/6월) 수정
      var colMap = { m4: COL.m4, m5: COL.m5, m6: COL.m6 };
      var col = colMap[b.field];
      if (!col || !b.row) return json_({ ok: false, error: 'bad params' });
      sh.getRange(Number(b.row), col).setValue(b.value == null ? '' : b.value);
      return json_({ ok: true });
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
