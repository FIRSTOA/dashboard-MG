# 업무 대시보드 원래 상태 복구 안내

현재 확인 결과, 첨부해주신 `dashboard-MG-main.zip` 안의 전체 파일은 로컬에 보존되어 있던 `original_dashboard` 기준 파일과 **모두 동일**합니다. 즉, GitHub 화면에 보이는 최근 `Add files via upload` 커밋은 파일 시각상 최근으로 보이지만, 코드 내용 자체는 오늘 작업 전 원본과 일치합니다.

| 확인 항목 | 결과 |
|---|---|
| `index.html` | 원본과 동일 |
| `result-sheet-sync.gs` | 원본과 동일 |
| `goal-sheet-sync.gs` | 원본과 동일 |
| `supabase-schema.sql` | 원본과 동일 |
| `.clasp*`, `apps-script-backend.gs`, `appsscript.json`, 안내 문서 | 원본과 동일 |

따라서 코드 저장소 기준으로는 이미 원래 상태로 돌아와 있습니다. 남아 있을 수 있는 꼬임은 대체로 **실제 서비스에 반영되는 외부 배포 지점**에서 발생합니다. 특히 Supabase SQL Editor에서 오늘 중간 SQL을 실행했거나, Google Apps Script 웹앱을 수정본 상태로 배포한 뒤 원본으로 다시 재배포하지 않았다면 GitHub 파일이 원본이어도 서비스는 여전히 꼬인 상태처럼 보일 수 있습니다.

## 가장 안전한 복구 순서

1. GitHub에는 이 패키지의 파일을 그대로 유지하십시오. 현재 ZIP과 원본 백업이 완전히 동일하므로 GitHub 파일 자체는 더 수정하지 않는 것이 안전합니다.
2. Supabase SQL Editor에서 `supabase-schema.sql` 전체를 다시 실행하십시오. 오늘 `global` 스코프나 `app_load`/`app_save` 관련 SQL을 실행했다면 이 단계가 가장 중요합니다.
3. Google Apps Script에서 `result-sheet-sync.gs`, `goal-sheet-sync.gs`, 필요 시 `apps-script-backend.gs`를 이 패키지의 원본 내용으로 전체 교체한 뒤, 각각 **새 버전으로 웹앱 재배포**하십시오.
4. 대시보드가 GitHub Pages 또는 정적 호스팅으로 연결되어 있다면 배포 캐시가 남을 수 있으므로 새로고침 또는 재배포 완료 후 확인하십시오.

## 어디서부터 꼬였는지에 대한 판단

파일 비교 기준으로는 GitHub에 올라간 핵심 파일과 원본 백업 사이의 차이가 없습니다. 따라서 꼬임의 시작점은 파일 내용 자체보다는 오늘 작업 중 실제 외부 서비스에 적용된 설정 또는 배포 상태일 가능성이 큽니다. 특히 Supabase에 첨부 텍스트처럼 관리자 비밀번호 변경 또는 RPC 일부 재정의 SQL을 실행했다면, `supabase-schema.sql` 전체 재실행 전까지 데이터베이스 함수 상태가 원본과 달라질 수 있습니다.

> 결론적으로, 현재 필요한 조치는 코드를 더 고치는 것이 아니라 **원본 SQL 재실행 + Apps Script 원본 재배포**입니다.
