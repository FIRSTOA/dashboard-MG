# clasp로 결과표 GAS 배포하기

`result-sheet-sync.gs` 를 구글 Apps Script로 빠르게 올리고 재배포하는 방법.
(매번 편집기에 복붙 → UI 클릭 대신, 명령 한두 줄로 끝)

---

## 0. 최초 1회 설치

```bash
npm install -g @google/clasp     # clasp 설치
clasp login                      # 브라우저에서 본인 구글계정(admin@firstoa-ai.com) 인증
```

> `clasp login` 은 본인만 1회 하면 됨. 자격증명은 본인 PC(`~/.clasprc.json`)에만 저장됨.

또한 한 번만: https://script.google.com/home/usersettings 에서
**"Google Apps Script API" 를 ON** 으로 켜기.

---

## 1. 스크립트 ID 연결 (최초 1회)

결과표 스프레드시트에서 **확장 프로그램 → Apps Script** 열기 →
**프로젝트 설정(⚙️) → "스크립트 ID" 복사**.

그 다음 이 폴더에서:

```bash
cp .clasp.json.example .clasp.json
```

`.clasp.json` 의 `scriptId` 자리에 복사한 ID를 붙여넣기.
(이 파일은 .gitignore 처리돼 커밋되지 않음)

---

## 2. 코드 올리기 (수정할 때마다)

```bash
git pull                 # 최신 result-sheet-sync.gs 받기
clasp push               # Apps Script로 업로드 (.claspignore 덕에 이 파일만 올라감)
```

---

## 3. 재배포 (공유용 /exec URL 갱신)

같은 URL을 유지하려면 **기존 배포를 새 버전으로** 갱신:

```bash
clasp deployments        # 배포 목록에서 deploymentId 확인 (AKfyc... 로 시작)
clasp deploy -i <deploymentId> -d "update"
```

> 처음 한 번은 그냥 `clasp deploy` 로 새 배포를 만들고, 그 ID를 위에 사용하면 됨.
> `appsscript.json` 에 웹앱 설정(실행=나, 액세스=모든 사용자)이 들어있어 매번 그대로 유지됨.

---

## 요약 (평소 작업)

```bash
git pull && clasp push && clasp deploy -i <deploymentId> -d "update"
```

이 한 줄이면 대시보드 결과표 연동에 바로 반영됨.
