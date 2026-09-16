// approval messages stay together so this catalogue has one clear UI owner.
import { defineCatalog } from "../types";

export const approvalCatalog = defineCatalog(
  {
    "approval.approveAndRunWrite": "Approve & run write",
    "approval.payloadHash": "Exact payload SHA-256:",
    "approval.reject": "Reject",
    "approval.riskHigh": "high risk",
  },
  {
    "approval.approveAndRunWrite": "승인 후 쓰기 실행",
    "approval.payloadHash": "정확한 페이로드 SHA-256:",
    "approval.reject": "거부",
    "approval.riskHigh": "높은 위험",
  },
);
