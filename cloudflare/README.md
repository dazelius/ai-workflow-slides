# suile.im/edu — 구글 계정 로그인으로 슬라이드 접근 제한하기

`suile.im`은 그대로 두고, `suile.im/edu` 이하 경로에서만 지금 GitHub Pages에
배포된 슬라이드(`dazelius.github.io/ai-workflow-slides`)를 보여주면서,
Cloudflare Access로 로그인(구글 계정 또는 이메일 인증코드)한 사람만 볼 수 있게
막는 구조입니다.

```
방문자 → suile.im/edu/... → [Cloudflare Access: 로그인 확인] → [Worker: GitHub Pages로 중계] → 실제 슬라이드
```

이 저장소(`ai-workflow-slides`)의 코드는 전부 상대경로를 쓰고 있어서
바꿀 게 없습니다. 아래는 Cloudflare 대시보드에서 직접 해야 하는 단계입니다
(제3자 계정 로그인이 필요해서 대신 실행해드릴 수 없는 부분입니다).

## 0. 준비 확인

- [ ] `suile.im`이 이미 Cloudflare에 등록돼 있고 네임서버가 Cloudflare로
      바뀌어 있나요? (Cloudflare 대시보드 → 해당 도메인 → 상단에 "Active"로
      표시되면 완료된 상태입니다)
  - 아니라면: Cloudflare 가입 → "Add a Site" → `suile.im` 입력 → 무료(Free)
    플랜 선택 → 안내받은 네임서버 2개를 도메인을 구입한 곳(가비아/후이즈 등)의
    네임서버 설정에 등록. 반영까지 몇 분~몇 시간 걸릴 수 있습니다.

## 1. Worker 배포 — `edu-proxy-worker.js`

1. Cloudflare 대시보드 → **Workers & Pages** → **Create** → **Create Worker**
2. 이름은 자유(예: `edu-proxy`)로 만들고, 에디터에 이 폴더의
   `edu-proxy-worker.js` 내용을 그대로 붙여넣은 뒤 **Deploy**

## 2. 라우트 연결 — `suile.im/edu*` → Worker

1. `suile.im` 도메인 화면 → **Workers Routes** (또는 좌측 Workers & Pages →
   해당 도메인의 "Triggers" 탭)
2. **Add route** → 라우트 패턴에 `suile.im/edu*` 입력, 방금 만든
   `edu-proxy` Worker 선택 → 저장

이 시점에서 `https://suile.im/edu/`로 접속하면(아직 Access 설정 전이라)
누구나 슬라이드가 그대로 보입니다 — 다음 단계로 로그인 게이트를 씌웁니다.

## 3. Cloudflare Zero Trust 팀 만들기 (처음 한 번만)

1. 대시보드 좌측 **Zero Trust** 클릭 → 팀 이름(임의로, 예: `suile-team`)
   정하고 무료 플랜으로 진행

## 4. 로그인 방법 설정

두 가지 중 선택하세요 (나중에 둘 다 켜두고 로그인 화면에서 골라 쓸 수도 있음):

**A. 이메일 원타임 코드 (추천 — 설정 5분, 구글 계정 불필요)**
- Zero Trust는 기본적으로 "One-time PIN"이 켜져 있습니다. 그대로 두면
  로그인 시 본인 이메일로 인증 코드가 오고, 코드만 입력하면 통과합니다.
  구글 계정이든 아니든 이메일 주소 하나만 있으면 되고, 뒤에서 그 이메일만
  허용하도록 정책을 걸면 사실상 "나만 들어올 수 있음"이 됩니다.

**B. 진짜 "Google로 로그인" 버튼 (설정 15~20분, Google Cloud 콘솔 필요)**
1. **Zero Trust → Settings → Authentication → Login methods → Add new →
   Google**
2. Cloudflare가 알려주는 리다이렉트 URL을 복사해둡니다
3. [Google Cloud Console](https://console.cloud.google.com/) → 새 프로젝트
   생성(또는 기존 프로젝트) → **APIs & Services → Credentials** →
   **Create Credentials → OAuth client ID** → Application type: **Web
   application**
4. Authorized redirect URIs에 2번에서 복사한 URL 붙여넣기 → 생성
5. 발급된 **Client ID / Client Secret**을 Cloudflare의 Google 로그인 설정
   화면에 붙여넣고 저장

## 5. Access Application 만들기 (실제 게이트)

1. **Zero Trust → Access → Applications → Add an application →
   Self-hosted**
2. Application domain: `suile.im`, Path: `/edu` (하위 전체를 포함해서 보호)
3. Session Duration: 원하는 만큼(예: 24시간 또는 1주일)
4. **Policies** 단계에서 정책 추가:
   - Action: **Allow**
   - Include 규칙: **Emails** → 본인의 구글 이메일(예: `you@gmail.com`) 입력
   - (4-A를 선택했다면 Login method도 "One-time PIN"으로 지정,
     4-B라면 "Google"로 지정)
5. 저장하면 즉시 적용됩니다.

## 6. 확인

- 시크릿(익명) 창에서 `https://suile.im/edu/` 접속 → Cloudflare 로그인
  화면이 먼저 뜨는지 확인
- 등록한 이메일로 로그인 시도 → 통과해서 슬라이드가 정상적으로 보이는지 확인
- 다른(허용 안 한) 이메일로 시도 → 접근 거부되는지 확인

## 참고

- `suile.im/edu/#12` 처럼 뒤에 `#번호`를 붙이면 특정 슬라이드로 바로 이동합니다
  (로그인 게이트를 통과한 뒤에도 그대로 동작합니다).
- GitHub Pages 저장소는 여전히 공개 상태입니다 — `dazelius.github.io/ai-workflow-slides`
  로 직접 접속하면 이 게이트를 거치지 않고 보일 수 있습니다. 완전히 막으려면
  나중에 그 URL 자체를 비공개로 돌리거나(GitHub Pro 필요), robots 차단 정도로
  검색엔진 노출만 막는 방법을 추가로 고려하세요.
