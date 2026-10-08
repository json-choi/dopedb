// workspaceAccount messages (account sessions, deletion recovery and workspace creation)
// are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const workspaceAccountCatalog = defineCatalog(
  {
    "workspaceAccount.description":
      "Browsers and devices signed in to this account, and the workspaces you own that are scheduled for deletion. Switch accounts or sign out from the account menu.",
    "workspaceAccount.sessionsTitle": "Signed-in devices and sessions",
    "workspaceAccount.sessionsDescription":
      "Web browsers and DopeDB Desktop apps signed in with this account. Ending a session signs that browser or device out.",
    "workspaceAccount.refreshSessions": "Refresh sessions",
    "workspaceAccount.sessionsLoadFailed": "Could not load sessions.",
    "workspaceAccount.noOtherSessions": "No other browser or device is signed in to this account.",
    "workspaceAccount.clientBrowser": "Web browser",
    "workspaceAccount.clientDesktop": "DopeDB Desktop",
    "workspaceAccount.currentSession": "Current session",
    "workspaceAccount.activeNow": "Active just now",
    "workspaceAccount.lastActive": "Last active {time}",
    "workspaceAccount.signedIn": "Signed in {date}",
    "workspaceAccount.endSession": "End session",
    "workspaceAccount.endBrowserSessionConfirm":
      "End this web browser session? The browser must sign in again to use this account.",
    "workspaceAccount.endDesktopSessionConfirm":
      "End this DopeDB Desktop session? That device must sign in again to use this account.",
    "workspaceAccount.sessionEnded": "Session ended.",
    "workspaceAccount.endSessionFailed": "Could not end the session.",
    "workspaceAccount.currentSessionCannotEnd":
      "DopeDB is using this session. To end it, sign out from the account menu.",
    "workspaceAccount.deletionTitle": "Workspaces scheduled for deletion",
    "workspaceAccount.deletionDescription":
      "Members and devices can't use these workspaces until you cancel the deletion. At the permanent deletion time, shared metadata and keys are removed for good.",
    "workspaceAccount.deletionLoadFailed": "Could not check for workspaces scheduled for deletion.",
    "workspaceAccount.purgeAt": "Permanently deleted on {date}",
    "workspaceAccount.purgeScheduled": "Scheduled for permanent deletion",
    "workspaceAccount.cancelDeletion": "Cancel deletion",
    "workspaceAccount.cancellingDeletion": "Cancelling…",
    "workspaceAccount.deletionCancelled": "Deletion of {name} was cancelled.",
    "workspaceAccount.cancelDeletionFailed": "Could not cancel the deletion.",
    "workspaceAccount.cancelDeletionExpired":
      "This deletion can no longer be cancelled. The permanent deletion time has passed or the request changed.",
    "workspaceAccount.cancelDeletionUnavailable":
      "You can't cancel this deletion. The workspace may already be removed, or your owner access changed.",
    "workspaceAccount.createDescription":
      "Create a team workspace to share connections and policy. Your account becomes its owner, and DopeDB switches to it right away.",
    "workspaceAccount.nameLabel": "Workspace name",
    "workspaceAccount.namePlaceholder": "e.g. Data Platform",
    "workspaceAccount.nameTooLong": "Use 120 characters or fewer.",
    "workspaceAccount.nameControl": "Use a single line without control characters.",
    "workspaceAccount.nameInvalid": "Workspace names must be a single line of 1–120 characters.",
    "workspaceAccount.create": "Create workspace",
    "workspaceAccount.creating": "Creating…",
    "workspaceAccount.opening": "Switching to {name}…",
    "workspaceAccount.createFailed": "Could not create the workspace.",
    "workspaceAccount.createLimitReached": "This account has reached the maximum number of workspaces.",
    "workspaceAccount.createNotAllowed": "This account can't create workspaces.",
    "workspaceAccount.workspaceCreated": "Created {name} and switched to it.",
    "workspaceAccount.openCreatedFailed":
      "{name} was created, but DopeDB could not switch to it. Try again, or choose it from the workspace menu later.",
    "workspaceAccount.createdUnreadable":
      "The workspace was created, but DopeDB could not read the response. Choose it from the workspace menu.",
  },
  {
    "workspaceAccount.description":
      "이 계정으로 로그인한 브라우저와 기기, 그리고 삭제가 예약된 내 워크스페이스입니다. 계정 전환과 로그아웃은 계정 메뉴에서 하세요.",
    "workspaceAccount.sessionsTitle": "로그인한 기기와 세션",
    "workspaceAccount.sessionsDescription":
      "이 계정으로 로그인한 웹 브라우저와 DopeDB Desktop입니다. 세션을 종료하면 해당 브라우저나 기기에서 로그아웃됩니다.",
    "workspaceAccount.refreshSessions": "세션 새로고침",
    "workspaceAccount.sessionsLoadFailed": "세션을 불러오지 못했습니다.",
    "workspaceAccount.noOtherSessions": "이 계정으로 로그인한 다른 브라우저나 기기가 없습니다.",
    "workspaceAccount.clientBrowser": "웹 브라우저",
    "workspaceAccount.clientDesktop": "DopeDB Desktop",
    "workspaceAccount.currentSession": "현재 세션",
    "workspaceAccount.activeNow": "방금 활동",
    "workspaceAccount.lastActive": "최근 활동 {time}",
    "workspaceAccount.signedIn": "{date} 로그인",
    "workspaceAccount.endSession": "세션 종료",
    "workspaceAccount.endBrowserSessionConfirm":
      "이 웹 브라우저 세션을 종료할까요? 해당 브라우저에서 이 계정을 사용하려면 다시 로그인해야 합니다.",
    "workspaceAccount.endDesktopSessionConfirm":
      "이 DopeDB Desktop 세션을 종료할까요? 해당 기기에서 이 계정을 사용하려면 다시 로그인해야 합니다.",
    "workspaceAccount.sessionEnded": "세션을 종료했습니다.",
    "workspaceAccount.endSessionFailed": "세션을 종료하지 못했습니다.",
    "workspaceAccount.currentSessionCannotEnd":
      "DopeDB가 사용 중인 세션입니다. 종료하려면 계정 메뉴에서 로그아웃하세요.",
    "workspaceAccount.deletionTitle": "삭제 예약된 워크스페이스",
    "workspaceAccount.deletionDescription":
      "삭제를 취소하기 전까지 구성원과 기기는 이 워크스페이스를 사용할 수 없습니다. 영구 삭제 시각이 되면 공유 메타데이터와 키가 완전히 제거됩니다.",
    "workspaceAccount.deletionLoadFailed": "삭제 예약된 워크스페이스를 확인하지 못했습니다.",
    "workspaceAccount.purgeAt": "{date}에 영구 삭제",
    "workspaceAccount.purgeScheduled": "영구 삭제 예정",
    "workspaceAccount.cancelDeletion": "삭제 취소",
    "workspaceAccount.cancellingDeletion": "취소 중…",
    "workspaceAccount.deletionCancelled": "{name} 워크스페이스의 삭제를 취소했습니다.",
    "workspaceAccount.cancelDeletionFailed": "삭제를 취소하지 못했습니다.",
    "workspaceAccount.cancelDeletionExpired":
      "더 이상 삭제를 취소할 수 없습니다. 영구 삭제 시각이 지났거나 삭제 요청이 바뀌었습니다.",
    "workspaceAccount.cancelDeletionUnavailable":
      "이 삭제는 취소할 수 없습니다. 워크스페이스가 이미 제거되었거나 소유자 권한이 바뀌었을 수 있습니다.",
    "workspaceAccount.createDescription":
      "연결과 정책을 함께 쓸 팀 워크스페이스를 만듭니다. 이 계정이 소유자가 되며, 만든 뒤 바로 새 워크스페이스로 전환합니다.",
    "workspaceAccount.nameLabel": "워크스페이스 이름",
    "workspaceAccount.namePlaceholder": "예: Data Platform",
    "workspaceAccount.nameTooLong": "120자 이하로 입력하세요.",
    "workspaceAccount.nameControl": "줄바꿈이나 제어 문자 없이 한 줄로 입력하세요.",
    "workspaceAccount.nameInvalid": "워크스페이스 이름은 1~120자의 한 줄이어야 합니다.",
    "workspaceAccount.create": "워크스페이스 만들기",
    "workspaceAccount.creating": "만드는 중…",
    "workspaceAccount.opening": "{name} 워크스페이스로 전환하는 중…",
    "workspaceAccount.createFailed": "워크스페이스를 만들지 못했습니다.",
    "workspaceAccount.createLimitReached": "이 계정으로 만들 수 있는 워크스페이스 수의 한도에 도달했습니다.",
    "workspaceAccount.createNotAllowed": "이 계정은 워크스페이스를 만들 수 없습니다.",
    "workspaceAccount.workspaceCreated": "{name} 워크스페이스를 만들고 전환했습니다.",
    "workspaceAccount.openCreatedFailed":
      "{name} 워크스페이스를 만들었지만 전환하지 못했습니다. 다시 시도하거나 나중에 워크스페이스 메뉴에서 선택하세요.",
    "workspaceAccount.createdUnreadable":
      "워크스페이스를 만들었지만 응답을 확인하지 못했습니다. 워크스페이스 메뉴에서 선택하세요.",
  },
);
