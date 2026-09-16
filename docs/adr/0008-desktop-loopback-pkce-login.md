# ADR 0008: Desktop loopback PKCE login

- 상태: Accepted
- 결정일: 2026-09-16

## 배경

DopeDB Desktop은 브라우저에서 Workspace 계정을 확인한 뒤 RFC 8628 device
authorization을 polling하고, 비밀값 없는 private-use URL로 실행 중인 앱을 다시
활성화했다. 이 경계는 session token을 WebView나 callback URL에 노출하지 않지만,
브라우저와 loopback listener를 사용할 수 있는 Desktop을 입력 제한 기기와 같은
device grant로 취급한다. 승인 뒤에도 주기적 polling이 완료를 판단하고 custom URL
scheme 등록 상태가 앱 복귀 UX를 좌우한다.

Desktop은 공개 native client이므로 client secret을 안전하게 보관할 수 없다. 반면
로컬 프로세스는 OS가 배정한 loopback port와 PKCE verifier를 한 로그인 시도 동안
메모리에만 보관할 수 있다. Workspace Web은 계속 배포된 HTTPS origin에서 로그인,
계정 선택, 명시적 승인을 소유해야 한다.

## 결정

Desktop Workspace 로그인은 authorization code와 PKCE S256을 사용하는 일회성
loopback handoff로 전환한다.

1. Rust가 `127.0.0.1`의 OS 할당 임시 port에 한 번만 수신하는 listener를 열고,
   PKCE verifier, state, redirect URI를 해당 시도의 메모리에만 보관한다.
2. 시스템 브라우저는 배포된 Workspace Web의 `/auth/desktop`을 연다. 로그인,
   다중 계정 선택, 승인과 거절은 HTTPS 웹에서 수행한다.
3. Workspace Web은 선택한 browser session, public client ID, 정확한 loopback URI,
   PKCE challenge에 묶인 짧은 수명의 authorization code를 발급한다. 저장소에는
   code 원문이 아니라 digest만 남긴다.
4. 브라우저는 `code`와 `state`만 loopback callback으로 전달한다. Rust는 state를
   검증한 뒤 code와 verifier를 HTTPS token endpoint에서 교환한다.
5. token endpoint는 code를 원자적으로 한 번만 소비하고 선택한 사용자에게 별도의
   Better Auth session을 발급한다. browser cookie나 browser session token을
   Desktop에 복사하지 않는다.
6. Rust는 발급된 session을 서버에서 다시 확인한 뒤 OS credential store에
   보관한다. session token, code, verifier는 WebView, frontend query cache, 로컬
   SQLite, callback HTML과 로그에 전달하지 않는다.

기존 RFC 8628 endpoint와 token-free private-use callback은 호환·복귀 경계로
유지한다. 현재 `dopedb` CLI에는 독립 Workspace 로그인 명령이 없으므로 이번 결정은
새 CLI 인증 기능을 추가하지 않는다. 향후 입력 제한 CLI가 독립 로그인을 소유하게
되면 device authorization을 사용할 수 있다.

## 보안 계약

- public client ID, `response_type=code`, `code_challenge_method=S256`, callback path를
  고정하고 중복 또는 알 수 없는 parameter를 거부한다.
- redirect URI는 URL 정규화 전에 `http://127.0.0.1:<ephemeral>/callback` 형태를
  검증한다. hostname, userinfo, query, fragment, 다른 path와 routable interface는
  허용하지 않는다.
- verifier와 state는 Rust 메모리에만 두고, 새 시도·취소·만료·앱 종료 시 listener와
  함께 폐기한다. 동시에 진행되는 Desktop 로그인은 하나뿐이다.
- browser 승인 mutation은 cookie-only session, exact same-origin, session/request에
  묶인 nonce와 명시적 사용자 action을 요구한다.
- authorization code는 CSPRNG로 만들고 짧게 만료하며, PKCE challenge, client,
  redirect, 사용자와 browser session에 묶어 원자적으로 한 번만 소비한다.
- loopback 응답은 code와 token을 반영하지 않는 고정 HTML과 `no-store`, 제한된 CSP를
  사용한다. listener는 유효 callback 하나 뒤 즉시 닫는다.
- 로그인 완료 뒤에도 기존 Broker authority fencing, workspace membership 재검증,
  private cache 폐기를 그대로 수행한다.

## 결과

Desktop은 custom URL dispatch를 로그인 증거로 사용하지 않고 브라우저에서 돌아온
정확한 시도와 verifier를 증명한다. 승인 직후 불필요한 device polling이 사라지고,
로그인 비밀값은 native backend와 HTTPS 교환 안에 머문다.

대신 native listener 수명, port·HTTP parser 제한, 취소·동시 시도·앱 종료 경합,
authorization code 저장과 원자 소비가 새 보안 책임이 된다. macOS와 Windows의 실제
packaged Google 왕복을 확인하기 전에는 Workspace 인증 UI 상태를 `complete`로
올리지 않는다.

일반 외부 OAuth client, resource-bound access token, refresh token 또는 dynamic
client registration이 필요해질 때는 Better Auth OAuth Provider 도입을 별도 결정으로
검토한다. 이번 first-party Desktop handoff는 기존 session/Bearer API 계약을 유지한다.
