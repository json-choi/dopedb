import {
  analyzeSqlDraft,
  type SqlDraftAnalysisRequest,
  type SqlDraftAnalysisResult,
} from "./sqlDraftAnalysis";

const workerScope = self as unknown as {
  location: { origin: string };
  onmessage:
    | ((event: MessageEvent<SqlDraftAnalysisRequest>) => void)
    | null;
  postMessage(message: SqlDraftAnalysisResult): void;
};

workerScope.onmessage = (event) => {
  // Dedicated workers normally receive an empty origin. Accept a populated
  // origin only when it matches the worker's own immutable script origin.
  if (event.origin !== "" && event.origin !== workerScope.location.origin) return;
  workerScope.postMessage(analyzeSqlDraft(event.data));
};

export {};
