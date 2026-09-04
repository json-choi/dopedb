// documents messages are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const documentsCatalog = defineCatalog(
  {
    "documents.cancel": "Cancel query",
    "documents.cancelled": "Query cancelled.",
    "documents.collection": "Collection",
    "documents.collectionsUnavailable": "Collections unavailable",
    "documents.catalogLoadFailed":
      "Collections could not be loaded. {error}",
    "documents.catalogRefreshFailed":
      "The loaded collections are still available, but they could not be refreshed. {error}",
    "documents.docCount": "{count} documents",
    "documents.filter": "Filter (JSON)",
    "documents.limit": "Limit",
    "documents.limitInvalid": "Enter a whole number from 1 to {max}.",
    "documents.loadingCollections": "Loading collections…",
    "documents.noCollections": "No collections to query.",
    "documents.noDocuments": "No documents returned.",
    "documents.operation": "Operation",
    "documents.pipeline": "Pipeline (JSON array)",
    "documents.projection": "Projection (JSON)",
    "documents.run": "Run",
    "documents.running": "Running",
    "documents.sort": "Sort (JSON)",
    "documents.title": "MongoDB query",
    "documents.truncated": "capped - refine the query to see more",
  },
  {
    "documents.cancel": "쿼리 취소",
    "documents.cancelled": "쿼리가 취소되었습니다.",
    "documents.collection": "컬렉션",
    "documents.collectionsUnavailable": "컬렉션을 사용할 수 없음",
    "documents.catalogLoadFailed":
      "컬렉션을 불러오지 못했습니다. {error}",
    "documents.catalogRefreshFailed":
      "불러온 컬렉션을 계속 사용할 수 있지만 새로고침하지 못했습니다. {error}",
    "documents.docCount": "{count}개 문서",
    "documents.filter": "필터 (JSON)",
    "documents.limit": "제한",
    "documents.limitInvalid": "1~{max} 사이의 정수를 입력하세요.",
    "documents.loadingCollections": "컬렉션 불러오는 중…",
    "documents.noCollections": "조회할 컬렉션이 없습니다.",
    "documents.noDocuments": "반환된 문서가 없습니다.",
    "documents.operation": "작업",
    "documents.pipeline": "파이프라인 (JSON 배열)",
    "documents.projection": "프로젝션 (JSON)",
    "documents.run": "실행",
    "documents.running": "실행 중",
    "documents.sort": "정렬 (JSON)",
    "documents.title": "MongoDB 조회",
    "documents.truncated": "제한됨 - 쿼리를 조정해 더 보세요",
  },
);
