// Static, CSP-hashed browser enhancement. Never read callback codes or tokens.
(() => {
  const page = document.documentElement.dataset.page;
  const ko = navigator.language.toLowerCase().startsWith("ko");
  document.documentElement.lang = ko ? "ko" : "en";
  document.getElementById("login-eyebrow").textContent = ko ? "데스크톱 로그인" : "Desktop sign-in";
  const copy = {
    received: ko
      ? ["인증을 앱에 전달했어요", "DopeDB로 돌아가 로그인 결과를 확인해 주세요.", "DopeDB로 돌아가기", "이 탭은 닫아도 됩니다. 앱에서 연결에 실패하면 로그인을 다시 시작해 주세요."]
      : ["Authorization sent to the app", "Return to DopeDB to check your sign-in result.", "Return to DopeDB", "You can close this tab. If the app cannot connect, start sign-in again."],
    denied: ko
      ? ["로그인을 취소했어요", "이 요청으로 계정이 연결되지 않았습니다.", "DopeDB로 돌아가기", "다시 로그인하려면 앱에서 시작해 주세요. 이 탭은 닫아도 됩니다."]
      : ["Sign-in cancelled", "No account was connected by this request.", "Return to DopeDB", "Start again from the app when you are ready. You can close this tab."],
    incomplete: ko
      ? ["앱에서 로그인 상태를 확인해 주세요", "이 페이지를 다시 열어도 로그인 요청이 재전송되지는 않습니다.", "DopeDB 앱 열기", "로그인이 완료되지 않았다면 앱에서 다시 시작해 주세요."]
      : ["Check sign-in in the app", "Reopening this page does not resend your sign-in request.", "Open DopeDB", "If sign-in did not finish, start again from the app."],
    invalid: ko
      ? ["로그인 요청을 확인할 수 없어요", "요청이 유효하지 않습니다. DopeDB에서 로그인을 다시 시작해 주세요.", "DopeDB로 돌아가기", "이 탭은 닫아도 됩니다."]
      : ["Unable to verify this request", "This request is invalid. Start sign-in again from DopeDB.", "Return to DopeDB", "You can close this tab."],
  };
  const text = copy[page] || copy.invalid;
  ["login-title", "login-description", "login-action-label", "login-hint"].forEach((id, index) => {
    document.getElementById(id).textContent = text[index];
  });
  const diagnostic = document.documentElement.dataset.diagnostic;
  const reasons = {
    LOGIN_REQUEST: ko ? "앱이 브라우저 요청 형식을 읽지 못했습니다." : "The app could not read the browser request.",
    LOGIN_TIMEOUT: ko ? "브라우저 요청을 받는 시간이 초과됐습니다." : "The browser request timed out.",
    LOGIN_PATH: ko ? "앱으로 돌아온 주소가 로그인 반환 주소와 다릅니다." : "The return address does not match the sign-in callback.",
    LOGIN_PARAMETERS: ko ? "로그인 응답에 예상하지 못한 항목이 있습니다." : "The sign-in response contains unexpected parameters.",
    LOGIN_STATE: ko ? "앱에서 시작한 로그인 요청과 돌아온 요청이 일치하지 않습니다." : "The return request does not match the sign-in attempt in the app.",
    LOGIN_CODE: ko ? "앱에서 사용할 인증 코드를 확인하지 못했습니다." : "The app could not validate the authorization code.",
  };
  if (page === "invalid" && Object.hasOwn(reasons, diagnostic)) {
    document.getElementById("login-description").textContent = reasons[diagnostic];
    const detail = document.getElementById("login-diagnostic");
    detail.hidden = false;
    detail.textContent = `${ko ? "진단 코드" : "Diagnostic code"}: ${diagnostic}`;
  }
  document.title = `${text[0]} · DopeDB`;
  const action = document.getElementById("login-action");
  action.hidden = false;
  action.addEventListener("submit", (event) => {
    event.preventDefault();
    // Only the fixed token-free app activation URL is used.
    location.href = "__APP_URL__";
  });
  history.replaceState(null, "", "/complete");
})();
