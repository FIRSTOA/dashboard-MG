/**
 * 개인 업무 대시보드 — 동기화 백엔드 (Google Apps Script)
 * ------------------------------------------------------------------
 * 이 코드는 대시보드(index.html)의 데이터를 Google 시트에 저장하여
 * 어느 기기에서 접속하든 같은 데이터를 보여주는 역할을 합니다.
 *
 * ● 한 백엔드로 여러 사람이 사용할 수 있습니다.
 *   대시보드에서 "내 이름"을 다르게 지정하면 사람마다 별도의 보드가 저장됩니다.
 *
 * ▣ 설치 방법 (한 번만)
 *   1. https://sheets.google.com 에서 새 구글 시트를 하나 만듭니다.
 *   2. 상단 메뉴 [확장 프로그램] → [Apps Script] 를 엽니다.
 *   3. 기존 코드를 모두 지우고 이 파일 내용을 전부 붙여넣습니다.
 *   4. 디스크 아이콘으로 저장합니다.
 *   5. 우측 상단 [배포] → [새 배포] → 유형 선택 [웹 앱] 선택
 *        - 설명: 아무거나
 *        - 실행 계정: 나
 *        - 액세스 권한: "모든 사용자(Anyone)"
 *   6. [배포]를 누르고 권한을 승인합니다.
 *   7. 생성된 "웹 앱 URL"(……/exec 로 끝남)을 복사합니다.
 *   8. 대시보드 우측 상단 ⚙️ 설정에 "내 이름"과 이 URL을 붙여넣고 저장합니다.
 *
 * ※ 코드를 수정한 뒤에는 [배포] → [배포 관리] → 연필(수정) → [새 버전] 으로
 *   다시 배포해야 변경 사항이 반영됩니다.
 */

var SHEET_NAME = 'Data';
var CHUNK_SIZE = 40000; // 구글 시트 셀당 약 5만자 제한 회피 (이미지 등 대용량 대비)

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['userId', 'chunkIndex', 'data', 'updatedAt']);
  }
  return sh;
}

function doGet(e) {
  var userId = (e && e.parameter && e.parameter.userId) ? String(e.parameter.userId) : '';
  if (!userId) return json_({ ok: false, error: 'userId required' });
  try {
    return json_({ ok: true, data: readUser_(userId) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var userId = String(body.userId || '');
    if (!userId) return json_({ ok: false, error: 'userId required' });
    writeUser_(userId, body.data || {});
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function readUser_(userId) {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  var chunks = [];
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === userId) {
      chunks.push({ idx: Number(values[i][1]) || 0, data: String(values[i][2] || '') });
    }
  }
  if (!chunks.length) return {};
  chunks.sort(function (a, b) { return a.idx - b.idx; });
  var jsonStr = chunks.map(function (c) { return c.data; }).join('');
  try { return JSON.parse(jsonStr); } catch (e) { return {}; }
}

function writeUser_(userId, dataObj) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_();
    var values = sh.getDataRange().getValues();
    // 기존 사용자 행 삭제 (아래에서 위로)
    for (var i = values.length - 1; i >= 1; i--) {
      if (String(values[i][0]) === userId) sh.deleteRow(i + 1);
    }
    var jsonStr = JSON.stringify(dataObj);
    var now = new Date();
    var rows = [];
    for (var p = 0; p < jsonStr.length; p += CHUNK_SIZE) {
      rows.push([userId, rows.length, jsonStr.substring(p, p + CHUNK_SIZE), now]);
    }
    if (rows.length === 0) rows.push([userId, 0, '{}', now]);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
