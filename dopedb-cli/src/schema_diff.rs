//! One authorized, fresh catalog pair for CLI and session-scoped Agent callers.
//! Reuses existing Broker commands; credentials and database drivers stay in Desktop.

use dopedb_protocol::{
    compare_schema_catalogs, CatalogArguments, CatalogShowCommand, CatalogSnapshot,
    ConnectionSelector, ConnectionSelectorArguments, ConnectionShowCommand, ConnectionSummary,
    DatabaseEngine, SchemaDiff,
};

use crate::client::{BrokerClient, ClientError};

pub(crate) async fn load(
    client: &BrokerClient,
    baseline: CatalogArguments,
    target: CatalogArguments,
) -> Result<SchemaDiff, ClientError> {
    for database in [&baseline.database, &target.database].into_iter().flatten() {
        if database.is_empty() || database.len() > 256 || database.chars().any(char::is_control) {
            return Err(ClientError::InvalidArguments);
        }
    }
    // Authorize both selectors before fetching either schema. The same session
    // and runtime are retained across every request, including the final checks.
    let base_connection = connection(client, baseline.connection).await?;
    let target_connection = connection(client, target.connection).await?;
    if base_connection.engine != target_connection.engine {
        return Err(ClientError::SchemaDiffUnavailable(
            "schema diff requires two databases using the same engine",
        ));
    }
    if base_connection.engine == DatabaseEngine::Mongodb {
        return Err(ClientError::SchemaDiffUnavailable(
            "schema diff requires a relational catalog; MongoDB is not supported",
        ));
    }
    let baseline = snapshot(client, &base_connection, baseline.database).await?;
    let target = snapshot(client, &target_connection, target.database).await?;
    // A revoked or changed grant must fail the whole comparison, not return one
    // partial side or mistake the failed side for an empty database.
    for expected in [&base_connection, &target_connection] {
        if connection(client, ConnectionSelector::Id(expected.id)).await? != *expected {
            return Err(ClientError::SchemaDiffUnavailable(
                "the connection changed during comparison; run schema diff again",
            ));
        }
    }
    compare_schema_catalogs(&baseline, &target).map_err(ClientError::SchemaDiffUnavailable)
}

async fn connection(
    client: &BrokerClient,
    selector: ConnectionSelector,
) -> Result<ConnectionSummary, ClientError> {
    let summary = client
        .request::<ConnectionShowCommand>(&ConnectionSelectorArguments {
            connection: selector.clone(),
        })
        .await?;
    if matches!(selector, ConnectionSelector::Id(id) if id != summary.id) {
        return Err(ClientError::InvalidResponse);
    }
    Ok(summary)
}

async fn snapshot(
    client: &BrokerClient,
    connection: &ConnectionSummary,
    database: Option<String>,
) -> Result<CatalogSnapshot, ClientError> {
    let database = database.unwrap_or_else(|| connection.database.clone());
    // An explicit database uses Desktop's fresh introspection path, avoiding an
    // old UI catalog cache being reported as today's environment comparison.
    let snapshot = client
        .request::<CatalogShowCommand>(&CatalogArguments {
            connection: ConnectionSelector::Id(connection.id),
            database: Some(database.clone()),
        })
        .await?;
    if snapshot.connection_id() != connection.id
        || snapshot.database() != database
        || snapshot.engine() != connection.engine
    {
        return Err(ClientError::InvalidResponse);
    }
    Ok(snapshot)
}
