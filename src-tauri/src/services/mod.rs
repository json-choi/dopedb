//! Application feature composition shared by Tauri and the local CLI broker.
//!
//! Runtime behavior and DTO ownership live in `features/*`; this module only wires
//! concrete adapters into the cloneable application facade.

use crate::connection::ConnectionManager;
use crate::features::activity::{self, ActivityFeature};
use crate::features::agents::{self, AgentsFeature};
use crate::features::analysis_articles::{self, DesktopAnalysisArticlesFeature};
use crate::features::catalog::{self, CatalogFeature};
use crate::features::connections::{self as connection_feature, ConnectionsFeature};
use crate::features::documents::{self, DocumentFeature};
use crate::features::erd::{self, ErdFeature};
use crate::features::jobs::{self, JobsFeature};
use crate::features::knowledge::{self, KnowledgeFeature};
use crate::features::monitoring::{self, MonitoringFeature};
use crate::features::operation_control::{self, OperationControlFeature};
use crate::features::product_analytics::{self, ProductAnalyticsFeature};
use crate::features::providers::ProvidersFeature;
use crate::features::queries::QueriesFeature;
use crate::features::safety_settings::{self, SafetySettingsFeature};
use crate::features::scripts::{self, ScriptFeature};
use crate::features::sql_documents::{self, SqlDocumentsFeature};
use crate::features::workspaces::{self, WorkspacesFeature};
use crate::operations::OperationRuntime;
use crate::store::Store;

/// Cloneable application-service facade. Every clone retains the same local store and
/// scope-aware connection runtime, so every service method uses one authority boundary.
#[derive(Clone)]
pub(crate) struct ApplicationServices {
    pub(crate) activity: ActivityFeature,
    pub(crate) agents: AgentsFeature,
    pub(crate) analysis_article: DesktopAnalysisArticlesFeature,
    pub(crate) connections: ConnectionsFeature,
    pub(crate) catalog: CatalogFeature,
    pub(crate) document: DocumentFeature,
    pub(crate) erd: ErdFeature,
    pub(crate) job: JobsFeature,
    pub(crate) knowledge: KnowledgeFeature,
    pub(crate) monitoring: MonitoringFeature,
    pub(crate) operation: OperationControlFeature,
    pub(crate) providers: ProvidersFeature,
    pub(crate) product_analytics: ProductAnalyticsFeature,
    pub(crate) queries: QueriesFeature,
    pub(crate) safety: SafetySettingsFeature,
    pub(crate) script: ScriptFeature,
    pub(crate) sql_documents: SqlDocumentsFeature,
    pub(crate) workspace: WorkspacesFeature,
}

impl ApplicationServices {
    /// Constructs application services from the single composed provider feature.
    pub(crate) fn with_providers(
        store: Store,
        connections: ConnectionManager,
        operation: OperationRuntime,
        providers: ProvidersFeature,
    ) -> Self {
        let connection_credentials = connection_feature::system_connection_credentials();
        let queries = crate::features::queries::compose(
            store.clone(),
            connections.clone(),
            operation.clone(),
        );
        let operation_service =
            operation_control::compose(store.clone(), connections.clone(), operation.clone());
        let catalog = catalog::compose(store.clone(), connections.clone());
        let script = scripts::compose(
            store.clone(),
            connections.clone(),
            catalog.clone(),
            operation.clone(),
            queries.manual_transactions(),
        );
        let connection_feature = connection_feature::compose(
            store.clone(),
            connections.clone(),
            connection_credentials.clone(),
        );
        let knowledge = knowledge::compose(store.clone());
        let analysis_article =
            analysis_articles::compose(store.clone(), connections.clone(), knowledge.clone());
        let sql_documents = sql_documents::compose(store.clone(), connections.clone());
        let erd = erd::compose(store.clone(), connections.clone());
        let job = jobs::compose(
            store.clone(),
            connections.clone(),
            catalog.clone(),
            operation.clone(),
        );
        Self {
            activity: activity::compose(store.clone()),
            agents: agents::compose(),
            analysis_article,
            connections: connection_feature,
            catalog,
            document: documents::compose(store.clone(), connections.clone(), operation.clone()),
            erd,
            job,
            knowledge,
            monitoring: monitoring::compose(store.clone(), connections.clone(), operation.clone()),
            operation: operation_service,
            providers,
            product_analytics: product_analytics::compose(store.clone()),
            queries,
            safety: safety_settings::compose(store.clone(), connections.clone()),
            script,
            sql_documents,
            workspace: workspaces::compose(store, connections, connection_credentials),
        }
    }
}
