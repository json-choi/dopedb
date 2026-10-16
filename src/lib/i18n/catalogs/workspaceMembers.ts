// workspace member and invitation messages are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const workspaceMembersCatalog = defineCatalog(
  {
    "workspaceMembers.description": "Invite members, choose their workspace role, and remove access.",
    "workspaceMembers.inviteTitle": "Invite a member",
    "workspaceMembers.emailLabel": "Email",
    "workspaceMembers.emailPlaceholder": "name@example.com",
    "workspaceMembers.roleLabel": "Role",
    "workspaceMembers.roleViewerOption": "View only (cannot run)",
    "workspaceMembers.invite": "Invite",
    "workspaceMembers.inviting": "Creating the invitation…",
    "workspaceMembers.inviteHint":
      "Share the invitation link with the person you invite. Only someone signed in with the invited email address can accept it.",
    "workspaceMembers.emailInvalid": "Enter a valid email address.",
    "workspaceMembers.inviteCreated": "Invitation created for {email}.",
    "workspaceMembers.inviteReady": "Invitation ready for {email}. The link expires {date}.",
    "workspaceMembers.inviteKeptRole":
      "{email} already had a pending invitation, so it keeps the {role} role. To change the role, revoke that invitation and invite again.",
    "workspaceMembers.inviteLink": "Invitation link",
    "workspaceMembers.copyLink": "Copy link",
    "workspaceMembers.copyFailed": "Could not copy the link. Select it and copy it manually.",
    "workspaceMembers.linkCopied": "Invitation link copied",
    "workspaceMembers.membersTitle": "Members",
    "workspaceMembers.membersHint":
      "Role changes apply immediately and revoke the member's active short-lived database credentials.",
    "workspaceMembers.empty": "No members to show.",
    "workspaceMembers.you": "You",
    "workspaceMembers.joinedAt": "Joined {date}",
    "workspaceMembers.roleFor": "Role for {member}",
    "workspaceMembers.changingRole": "Changing role…",
    "workspaceMembers.removeMember": "Remove {member}",
    "workspaceMembers.removeConfirm":
      "{member} will lose access to {workspace}. Their workspace access, database grants and running database credentials are revoked immediately.",
    "workspaceMembers.removing": "Removing…",
    "workspaceMembers.loadFailed": "Could not load members and invitations.",
    "workspaceMembers.loadIncompatible":
      "The workspace service returned a member list this version of DopeDB cannot read.",
    "workspaceMembers.refreshFailed":
      "Could not refresh members and invitations. The list below may be out of date.",
    "workspaceMembers.invitationsTitle": "Pending invitations",
    "workspaceMembers.invitationsHint":
      "To change the role of a pending invitation, revoke it and invite again.",
    "workspaceMembers.expiresAt": "Expires {date}",
    "workspaceMembers.expired": "Expired",
    "workspaceMembers.copyInvitationLink": "Copy invitation link for {email}",
    "workspaceMembers.recreateInvitation": "Create a new invitation for {email}",
    "workspaceMembers.recreating": "Creating…",
    "workspaceMembers.revokeInvitation": "Revoke invitation for {email}",
    "workspaceMembers.revokeConfirm":
      "The invitation link sent to {email} stops working. You can invite them again later.",
    "workspaceMembers.revoking": "Revoking…",
    "workspaceMembers.inviteFailed": "Could not create the invitation.",
    "workspaceMembers.roleChangeFailed": "Could not change the role.",
    "workspaceMembers.removeFailed": "Could not remove the member.",
    "workspaceMembers.revokeFailed": "Could not revoke the invitation.",
    "workspaceMembers.recreateFailed": "Could not create a new invitation.",
    "workspaceMembers.errorTransferArticles":
      "Transfer the Analysis Articles this member owns to another member before giving them this role.",
    "workspaceMembers.errorDeleteArticles":
      "Delete the Analysis Articles this member owns before removing them.",
    "workspaceMembers.errorChangeInProgress":
      "Another access change for this member is in progress. Try again shortly.",
    "workspaceMembers.errorChangedConcurrently":
      "This member's access changed at the same time. Check the refreshed list and try again.",
    "workspaceMembers.errorCredentialActive":
      "An active database credential could not be revoked yet. Try again after it expires.",
    "workspaceMembers.errorNoPermission":
      "You no longer have permission to manage this workspace's members.",
    "workspaceMembers.errorMemberGone": "This member was not found. They may already have been removed.",
    "workspaceMembers.errorInvitationGone":
      "This invitation was not found. It may already have been accepted or revoked.",
    "workspaceMembers.errorAlreadyMember": "This person is already a member of the workspace.",
    "workspaceMembers.errorInvitationLimit":
      "This workspace has reached its limit of pending invitations. Revoke unused invitations and try again.",
    "workspaceMembers.errorMembershipLimit": "This workspace has reached its member limit.",
  },
  {
    "workspaceMembers.description": "구성원을 초대하고 워크스페이스 역할을 정하거나 접근을 제거합니다.",
    "workspaceMembers.inviteTitle": "구성원 초대",
    "workspaceMembers.emailLabel": "이메일",
    "workspaceMembers.emailPlaceholder": "name@example.com",
    "workspaceMembers.roleLabel": "역할",
    "workspaceMembers.roleViewerOption": "보기 전용 (실행 불가)",
    "workspaceMembers.invite": "초대",
    "workspaceMembers.inviting": "초대를 만드는 중…",
    "workspaceMembers.inviteHint":
      "초대 링크를 초대할 사람에게 전달하세요. 초대한 이메일 주소로 로그인한 사람만 수락할 수 있습니다.",
    "workspaceMembers.emailInvalid": "올바른 이메일 주소를 입력하세요.",
    "workspaceMembers.inviteCreated": "{email} 초대를 만들었습니다.",
    "workspaceMembers.inviteReady": "{email} 초대가 준비되었습니다. 링크는 {date}에 만료됩니다.",
    "workspaceMembers.inviteKeptRole":
      "{email}에게 이미 대기 중인 초대가 있어 {role} 역할이 유지됩니다. 역할을 바꾸려면 기존 초대를 철회한 뒤 다시 초대하세요.",
    "workspaceMembers.inviteLink": "초대 링크",
    "workspaceMembers.copyLink": "링크 복사",
    "workspaceMembers.copyFailed": "링크를 복사하지 못했습니다. 링크를 선택해 직접 복사하세요.",
    "workspaceMembers.linkCopied": "초대 링크를 복사했습니다",
    "workspaceMembers.membersTitle": "구성원",
    "workspaceMembers.membersHint":
      "역할 변경은 즉시 적용되며 해당 구성원의 활성 단기 DB 자격 증명을 회수합니다.",
    "workspaceMembers.empty": "표시할 구성원이 없습니다.",
    "workspaceMembers.you": "나",
    "workspaceMembers.joinedAt": "{date} 참여",
    "workspaceMembers.roleFor": "{member}의 역할",
    "workspaceMembers.changingRole": "역할을 변경하는 중…",
    "workspaceMembers.removeMember": "{member} 제거",
    "workspaceMembers.removeConfirm":
      "{member} 님은 {workspace}에 더 이상 접근할 수 없습니다. 워크스페이스 접근 권한, DB 권한과 실행 중인 DB 자격 증명이 즉시 회수됩니다.",
    "workspaceMembers.removing": "제거하는 중…",
    "workspaceMembers.loadFailed": "구성원과 초대 목록을 불러오지 못했습니다.",
    "workspaceMembers.loadIncompatible":
      "워크스페이스 서비스가 이 버전의 DopeDB에서 읽을 수 없는 구성원 목록을 반환했습니다.",
    "workspaceMembers.refreshFailed":
      "구성원과 초대 목록을 새로 고치지 못했습니다. 아래 목록이 최신이 아닐 수 있습니다.",
    "workspaceMembers.invitationsTitle": "대기 중인 초대",
    "workspaceMembers.invitationsHint":
      "대기 중인 초대의 역할을 바꾸려면 초대를 철회한 뒤 다시 초대하세요.",
    "workspaceMembers.expiresAt": "{date} 만료",
    "workspaceMembers.expired": "만료됨",
    "workspaceMembers.copyInvitationLink": "{email} 초대 링크 복사",
    "workspaceMembers.recreateInvitation": "{email} 초대 다시 만들기",
    "workspaceMembers.recreating": "만드는 중…",
    "workspaceMembers.revokeInvitation": "{email} 초대 철회",
    "workspaceMembers.revokeConfirm":
      "{email}에게 전달한 초대 링크가 더 이상 동작하지 않습니다. 나중에 다시 초대할 수 있습니다.",
    "workspaceMembers.revoking": "철회하는 중…",
    "workspaceMembers.inviteFailed": "초대를 만들지 못했습니다.",
    "workspaceMembers.roleChangeFailed": "역할을 변경하지 못했습니다.",
    "workspaceMembers.removeFailed": "구성원을 제거하지 못했습니다.",
    "workspaceMembers.revokeFailed": "초대를 철회하지 못했습니다.",
    "workspaceMembers.recreateFailed": "초대를 다시 만들지 못했습니다.",
    "workspaceMembers.errorTransferArticles":
      "이 구성원이 소유한 분석 아티클을 다른 구성원에게 넘긴 뒤 이 역할로 변경하세요.",
    "workspaceMembers.errorDeleteArticles":
      "이 구성원이 소유한 분석 아티클을 삭제한 뒤 구성원을 제거하세요.",
    "workspaceMembers.errorChangeInProgress":
      "이 구성원의 다른 접근 변경이 진행 중입니다. 잠시 후 다시 시도하세요.",
    "workspaceMembers.errorChangedConcurrently":
      "이 구성원의 접근 권한이 동시에 변경되었습니다. 새로 고친 목록을 확인한 뒤 다시 시도하세요.",
    "workspaceMembers.errorCredentialActive":
      "사용 중인 DB 자격 증명을 아직 회수하지 못했습니다. 자격 증명이 만료된 뒤 다시 시도하세요.",
    "workspaceMembers.errorNoPermission": "이 워크스페이스의 구성원을 관리할 권한이 없습니다.",
    "workspaceMembers.errorMemberGone": "구성원을 찾을 수 없습니다. 이미 제거되었을 수 있습니다.",
    "workspaceMembers.errorInvitationGone":
      "초대를 찾을 수 없습니다. 이미 수락되었거나 철회되었을 수 있습니다.",
    "workspaceMembers.errorAlreadyMember": "이미 이 워크스페이스의 구성원입니다.",
    "workspaceMembers.errorInvitationLimit":
      "대기 중인 초대 수가 한도에 도달했습니다. 사용하지 않는 초대를 철회한 뒤 다시 시도하세요.",
    "workspaceMembers.errorMembershipLimit": "워크스페이스 구성원 수가 한도에 도달했습니다.",
  },
);
