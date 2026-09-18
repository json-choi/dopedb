// Static, CSP-hashed browser enhancement. Never read callback codes or tokens.
(() => {
  const page = document.documentElement.dataset.page;
  const ko = navigator.language.toLowerCase().startsWith("ko");
  document.documentElement.lang = ko ? "ko" : "en";
  document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const copy = {
    received: ko
      ? ["인증을 앱에 전달했어요", "DopeDB로 돌아가 로그인 결과를 확인해 주세요.", "DopeDB로 돌아가기", "이 탭은 닫아도 됩니다. 앱에서 연결에 실패하면 로그인을 다시 시작해 주세요."]
      : ["Authorization sent to the app", "Return to DopeDB to check your sign-in result.", "Return to DopeDB", "You can close this tab. If the app cannot connect, start sign-in again."],
    denied: ko
      ? ["로그인을 취소했어요", "이 요청으로 계정이 연결되지 않았습니다.", "DopeDB로 돌아가기", "다시 로그인하려면 앱에서 시작해 주세요. 이 탭은 닫아도 됩니다."]
      : ["Sign-in cancelled", "No account was connected by this request.", "Return to DopeDB", "Start again from the app when you are ready. You can close this tab."],
    invalid: ko
      ? ["로그인 요청을 확인할 수 없어요", "요청이 유효하지 않습니다. DopeDB에서 로그인을 다시 시작해 주세요.", "DopeDB로 돌아가기", "이 탭은 닫아도 됩니다."]
      : ["Unable to verify this request", "This request is invalid. Start sign-in again from DopeDB.", "Return to DopeDB", "You can close this tab."],
  };
  const text = copy[page] || copy.invalid;
  ["login-title", "login-description", "login-action-label", "login-hint"].forEach((id, index) => {
    document.getElementById(id).textContent = text[index];
  });
  document.title = `${text[0]} · DopeDB`;
  const action = document.getElementById("login-action");
  action.hidden = false;
  action.addEventListener("submit", (event) => {
    event.preventDefault();
    // Navigation permits the fixed HTTPS handoff without widening form-action.
    location.href = "__APP_URL__";
  });
  history.replaceState(null, "", "/complete");
})();
