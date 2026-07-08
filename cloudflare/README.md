# edu.suile.im — 구글 계정(또는 이메일) 로그인으로 슬라이드 접근 제한하기

`edu.suile.im` 서브도메인 전체를 GitHub Pages에 배포된 슬라이드
(`dazelius.github.io/ai-workflow-slides`)로 연결하고, Cloudflare Access로
로그인한 사람만 볼 수 있게 막는 구조입니다.

```
방문자 → edu.suile.im → [Cloudflare Access: 로그인 확인] → GitHub Pages 원본 → 슬라이드
```

서브도메인 하나를 통째로 쓰는 방식이라 경로 중계용 Worker가 필요 없습니다
(예전에 검토했던 `suile.im/edu` 경로 방식은 Worker로 중계해야 해서 더
복잡했는데, 서브도메인으로 바꾸면서 그 단계가 통째로 사라졌습니다).

이 저장소 루트에 GitHub Pages용 `CNAME` 파일(`edu.suile.im`)을 이미
추가해뒀습니다 — 아래 단계 중 2번만 완료하면 GitHub 쪽은 끝입니다.

### `suile.im` 루트는 전혀 건드리지 않습니다

`suile.im` 루트 도메인은 이미 Firebase Hosting에 연결돼 있어서, 도메인
전체를 Cloudflare 네임서버로 옮기면 Firebase 쪽 DNS(호스팅/구글 인증용
TXT 레코드 등)를 그대로 옮겨 재설정해야 하는 부담이 있습니다.

대신 **`edu` 서브도메인만 Cloudflare에 위임(NS delegation)**하는 방식을
씁니다 — Cloudflare에서 `edu.suile.im`을 그 자체로 별도의 "Site(존)"로
추가하면, Cloudflare가 그 서브도메인 전용 네임서버 2개를 내려줍니다.
도메인을 구입한 곳(후이즈 등)에서 `edu`라는 이름에 대해 **NS 레코드**로
그 네임서버 2개를 등록하면, `edu.suile.im` 밑으로는 Cloudflare가 권한을
갖게 되고 `suile.im` 루트와 나머지 레코드(Firebase 관련 A/TXT 등)는
그대로 안전하게 남습니다.

## 0. 준비 확인 (서브도메인 위임)

- [ ] Cloudflare 대시보드 → **Add a Site** → `edu.suile.im` 입력(주의:
      `suile.im`이 아니라 `edu.suile.im` 전체를 입력) → 무료 플랜 선택
- [ ] Cloudflare가 이 존 전용으로 내려주는 네임서버 2개를 확인합니다.
      (예: `evelyn.ns.cloudflare.com`, `phil.ns.cloudflare.com` — 계정마다
      값이 다르게 배정되니 실제 대시보드에 표시된 값을 써야 합니다)
- [ ] 도메인 등록기관(후이즈: 도메인 관리 → 네임서버 고급설정/네임서버
      호스팅) 안에서 **`NS레코드`(또는 "네임서버 레코드") 탭**을 찾습니다.
      A레코드나 TXT(SPF)레코드 탭이 아니라 **NS 전용 탭**이어야 위임이
      됩니다 — TXT로 넣으면 문자열만 저장될 뿐 실제 위임은 되지 않습니다.
- [ ] 그 NS레코드 탭에서 도메인명에 `edu`, 값에 위에서 받은 네임서버
      2개를 각각 등록하고 신청합니다.
- [ ] 반영 확인: 아래 명령으로 `edu.suile.im`의 NS가 Cloudflare
      네임서버로 나오면 위임이 끝난 상태입니다(보통 몇 분~몇 시간).

  ```powershell
  Resolve-DnsName -Name edu.suile.im -Type NS -Server 8.8.8.8
  ```

  Cloudflare 대시보드에서도 해당 Site 상태가 "Active"로 바뀝니다.

## 1. DNS 레코드 추가 (처음엔 반드시 "DNS only")

위임이 끝나면 `edu.suile.im` 자체가 Cloudflare의 "존 루트"가 되므로,
레코드 이름은 `edu`가 아니라 **`@`(루트)** 로 넣습니다.

1. Cloudflare 대시보드 → `edu.suile.im` 존 → **DNS** → **Add record**
2. Type: `CNAME`, Name: `@`, Target: `dazelius.github.io`
3. Proxy status는 **처음엔 반드시 회색(DNS only)** 으로 둡니다 — GitHub가
   인증서(HTTPS)를 발급하려면 우리 서버(Cloudflare)를 거치지 않고 도메인이
   GitHub 서버를 직접 가리키는 상태에서 확인해야 하기 때문입니다. 주황색
   (Proxied)으로 미리 켜두면 인증서 발급이 실패할 수 있습니다.

## 2. GitHub Pages에 커스텀 도메인 등록

리포 루트에 `CNAME` 파일(`edu.suile.im`)을 이미 추가해서 커밋해뒀습니다.
이제 GitHub 쪽 확인만 하면 됩니다:

1. GitHub 저장소 → **Settings → Pages**
2. **Custom domain**에 `edu.suile.im`이 이미 채워져 있는지 확인 (파일로
   커밋했으니 자동으로 인식됩니다. 안 보이면 같은 값을 직접 입력하고 Save)
3. "DNS check successful" 표시가 뜰 때까지 기다립니다(보통 몇 분, DNS
   전파에 따라 더 걸릴 수 있음)
4. 확인되면 **Enforce HTTPS** 체크박스가 활성화됩니다 — 체크해주세요
   (GitHub가 Let's Encrypt 인증서를 발급해준 상태입니다)

> 참고: 커스텀 도메인을 설정하면 기존의
> `https://dazelius.github.io/ai-workflow-slides/...` 링크는 자동으로
> `https://edu.suile.im/...`로 리다이렉트됩니다. 즉, 예전 링크로 들어와도
> 결국 Access 로그인 게이트를 통과해야 하게 되어 오히려 더 안전해집니다.

## 3. 인증서 확인 후 Cloudflare 프록시 켜기

1. GitHub에서 **Enforce HTTPS**가 정상적으로 켜진 걸 확인했다면, 다시
   Cloudflare `edu.suile.im` 존의 **DNS**로 가서 1번에서 만든 `@` 레코드의
   프록시 상태를 **주황색(Proxied)** 으로 전환합니다.
2. `edu.suile.im` 존 → **SSL/TLS** → Overview에서 암호화 모드를 **Full**
   (또는 **Full (strict)**, GitHub 인증서가 유효하므로 strict도 가능)로
   설정합니다.

## 4. Cloudflare Zero Trust 팀 만들기 (처음 한 번만)

1. 대시보드 좌측 **Zero Trust** 클릭 → 팀 이름(임의로, 예: `suile-team`)
   정하고 무료 플랜으로 진행

## 5. 로그인 방법 설정

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

## 6. Access Application 만들기 (실제 게이트)

1. **Zero Trust → Access → Applications → Add an application →
   Self-hosted**
2. Application domain: `edu.suile.im` (서브도메인 전체이므로 경로 지정 불필요)
3. Session Duration: 원하는 만큼(예: 24시간 또는 1주일)
4. **Policies** 단계에서 정책 추가:
   - Action: **Allow**
   - Include 규칙: **Emails** → 본인의 구글 이메일(예: `you@gmail.com`) 입력
   - (5-A를 선택했다면 Login method도 "One-time PIN"으로 지정,
     5-B라면 "Google"로 지정)
5. 저장하면 즉시 적용됩니다.

## 7. 확인

- 시크릿(익명) 창에서 `https://edu.suile.im/` 접속 → Cloudflare 로그인
  화면이 먼저 뜨는지 확인
- 등록한 이메일로 로그인 시도 → 통과해서 슬라이드가 정상적으로 보이는지 확인
  (자동으로 `slides/index.html`로 이동합니다)
- 다른(허용 안 한) 이메일로 시도 → 접근 거부되는지 확인
- `https://dazelius.github.io/ai-workflow-slides/`로도 접속해봐서, 결국
  `edu.suile.im`으로 리다이렉트되며 같은 로그인 게이트를 타는지 확인

## 참고

- `edu.suile.im/#12` 처럼 뒤에 `#번호`를 붙이면 특정 슬라이드로 바로 이동합니다
  (로그인 게이트를 통과한 뒤에도 그대로 동작합니다).
