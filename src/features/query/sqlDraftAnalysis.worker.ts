import {
  analyzeSqlDraft,
  type SqlDraftAnalysisRequest,
  type SqlDraftAnalysisResult,
} from "./sqlDraftAnalysis";

const workerScope = self as unknown as {
  onmessage:
    | ((event: MessageEvent<SqlDraftAnalysisRequest>) => void)
    | null;
  postMessage(message: SqlDraftAnalysisResult): void;
};

// This is a dedicated Worker, not a Window message channel: only its creating
// document can send messages and MessageEvent.origin is empty by specification.
// codeql[js/missing-origin-check]
workerScope.onmessage = (event) => {
  workerScope.postMessage(analyzeSqlDraft(event.data));
};

export {};
