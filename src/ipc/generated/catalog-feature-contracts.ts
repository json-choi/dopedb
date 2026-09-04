// Generated from src-tauri/src/features/catalog/domain.rs by ts-rs 12.0.1.
// Keep this checked-in wire contract synchronized with the Rust DTOs.

import type { Constraint as CatalogConstraint, IndexKey as CatalogIndexKey, ObjectRef as CatalogObjectRef } from "./protocol-contracts";

export type CatalogOverviewDetailState = "deferred";
export type DatabaseSummary = { name: string, isDefault: boolean, };
export type CatalogOverviewRelationRef = { schema: string | null, name: string, kind: string, nativeId: string | null, };
export type CatalogOverviewRelation = { schema: string | null, name: string, kind: string, nativeId: string | null, comment: string | null, rowEstimate: number | null, parent: CatalogOverviewRelationRef | null, };
export type CatalogOverview = { database: string, namespaces: Array<string>, relations: Array<CatalogOverviewRelation>, detailState: CatalogOverviewDetailState, };
export type Column = { name: string, dataType: string, nullable: boolean, pk: boolean, ordinal: number, length: number | null, precision: number | null, scale: number | null, defaultExpression: string | null, generatedExpression: string | null, identity: boolean, autoIncrement: boolean, collation: string | null, comment: string | null, };
export type ForeignKey = { name: string | null, ordinal: number, column: string, referencesTable: string, referencesColumn: string, referencesSchema: string | null, updateAction: string | null, deleteAction: string | null, deferrable: boolean, validated: boolean, };
export type Index = { name: string, columns: Array<string>, unique: boolean, method: string | null, keys: Array<CatalogIndexKey>, includedColumns: Array<string>, predicate: string | null, valid: boolean, };
export type Table = { database: string | null, schema: string | null, name: string, kind: string, nativeId: string | null, comment: string | null, partitionParent: CatalogObjectRef | null, partitionChildren: Array<CatalogObjectRef>, columns: Array<Column>, foreignKeys: Array<ForeignKey>, constraints: Array<CatalogConstraint>, indexes: Array<Index>, rowEstimate: number | null, };
export type DatabaseObject = { schema: string | null, name: string, kind: string, nativeId: string | null, detail?: string | null, parent?: string | null, arguments: Array<string>, returnType: string | null, language: string | null, comment: string | null, };
export type Catalog = { tables: Array<Table>, objects: Array<DatabaseObject>, };
