/**
 * 분기목표 → 구글시트 자동 입력 (Google Apps Script)
 * =====================================================
 * 대시보드에서 분기목표를 새로 만들면, 이 스크립트가 지정한 시트에 한 줄씩 자동 추가합니다.
 *
 * ▣ 설치 (목표를 기록할 본인 구글시트에서 1회)
 *   1. 목표를 모을 구글시트 열기 → [확장 프로그램] → [Apps Script]
 *   2. 이 코드 전체 붙여넣기 → 저장
 *   3. [배포] → [새 배포] → 유형 [웹 앱]
 *        - 실행 계정:  "나"
 *        - 액세스 권한: "모든 사용자"   (대시보드가 호출할 수 있도록)
 *   4. 배포 → 권한 승인 → 생성된 /exec URL 복사
 *   5. 대시보드 분기목표 화면의 [🔗 시트연동] 버튼에 그 URL을 붙여넣기
 *
 * ※ 첫 행에 헤더가 없으면 자동으로 만들어 줍니다.
 */

var SHEET_NAME = '분기목표';  // 기준 시트(탭) 이름. 팀원명이 오면 '팀원_분기목표' 탭에 기록합니다.
var HEADERS = ['입력일시', '분기', '제목', '분류', '등급', '목적', '방법', '완료'];

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var sh = getSheet_(body.member);
    sh.appendRow([
      new Date(),
      body.quarter || '',
      body.title || '',
      body.category || '',
      body.grade || '',
      body.purpose || '',
      body.method || '',
      body.done ? '완료' : ''
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() { return json_({ ok: true, msg: '분기목표 시트연동 정상 작동 중' }); }

function cleanMember_(member) {
  return String(member || '').trim();
}
function safeSheetName_(name) {
  var s = String(name || '').replace(/[\\\/\?\*\[\]\:]/g, '-').replace(/\s+/g, ' ').trim();
  if (!s) s = SHEET_NAME;
  return s.length > 95 ? s.slice(0, 95) : s;
}
function getSheet_(member) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var m = cleanMember_(member);
  var name = m ? safeSheetName_(m + '_' + SHEET_NAME) : SHEET_NAME;
  var sh = ss.getSheetByName(name);
  if (!sh) {
    var base = ss.getSheetByName(SHEET_NAME);
    sh = base ? base.copyTo(ss).setName(name) : ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  } else if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
