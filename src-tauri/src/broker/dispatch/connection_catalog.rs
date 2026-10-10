//! Connection and catalog broker handlers.
use super::*;

pub(super) async fn handle(
    dispatcher: &BrokerDispatcher,
    request: &RequestEnvelope,
) -> ResponseEnvelope {
    let request_id = request.request_id;
    let client_protocol_version = request.protocol_version;
    let capability = match request.command {
        CommandName::ConnectionList | CommandName::ConnectionShow => {
            BrokerCapability::ConnectionRead
        }
        CommandName::ConnectionTest => BrokerCapability::ConnectionTest,
        CommandName::DatabaseList
        | CommandName::CatalogShow
        | CommandName::CatalogSearch
        | CommandName::SchemaList
        | CommandName::TableDescribe => BrokerCapability::CatalogRead,
        _ => return failure(request_id, ErrorCode::InvalidRequest, false),
    };
    let session = match dispatcher.authenticate(request, capability) {
        Ok(session) => session,
        Err((code, retryable)) => return failure(request_id, code, retryable),
    };
    match request.command {
        CommandName::ConnectionList => {
            if decode_arguments::<ConnectionListCommand>(request).is_err() {
                return failure(request_id, ErrorCode::InvalidRequest, false);
            }
            respond(
                request_id,
                dispatcher
                    .connection_list(&session, client_protocol_version)
                    .await,
            )
        }
        CommandName::ConnectionShow => {
            let arguments = match decode_arguments::<ConnectionShowCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .resolve_connection(&session, &arguments.connection, client_protocol_version)
                    .await,
            )
        }
        CommandName::ConnectionTest => {
            let arguments = match decode_arguments::<ConnectionTestCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .connection_test(&session, &arguments, client_protocol_version)
                    .await,
            )
        }
        CommandName::DatabaseList => {
            let arguments = match decode_arguments::<DatabaseListCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .database_list(&session, &arguments.connection, client_protocol_version)
                    .await,
            )
        }
        CommandName::CatalogShow => {
            let arguments = match decode_arguments::<CatalogShowCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .catalog(&session, &arguments, client_protocol_version)
                    .await,
            )
        }
        CommandName::CatalogSearch => {
            let arguments = match decode_arguments::<CatalogSearchCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .catalog_search(&session, arguments, client_protocol_version)
                    .await,
            )
        }
        CommandName::SchemaList => {
            let arguments = match decode_arguments::<SchemaListCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .schema_list(&session, &arguments, client_protocol_version)
                    .await,
            )
        }
        CommandName::TableDescribe => {
            let arguments = match decode_arguments::<TableDescribeCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .table_describe(&session, &arguments, client_protocol_version)
                    .await,
            )
        }
        _ => unreachable!(),
    }
}

impl BrokerDispatcher {
    async fn connection_list(
        &self,
        session: &AuthenticatedSession,
        client_protocol_version: u16,
    ) -> Result<ConnectionListResult, ErrorCode> {
        let services = self.services()?;
        let authority = terminal_authority(session, client_protocol_version);
        // An Agent pinned to a Project resource set sees only its selected
        // databases; a source-only session must not learn the anchor DB.
        let resource_set_enforced =
            session.agent_plugin_id.is_some() && !session.knowledge_scopes.is_empty();
        let selected = session
            .knowledge_scopes
            .iter()
            .flat_map(|scope| scope.connections.iter())
            .map(|connection| connection.connection_id)
            .collect::<std::collections::BTreeSet<_>>();
        let connections = services
            .connections
            .list_terminal_summaries(&authority)
            .await
            .map_err(|_| ErrorCode::ScopeDenied)?
            .iter()
            .filter(|summary| !resource_set_enforced || selected.contains(&Uuid::from(summary.id)))
            .map(connection_summary)
            .collect();
        Ok(ConnectionListResult { connections })
    }

    pub(super) async fn resolve_connection(
        &self,
        session: &AuthenticatedSession,
        selector: &ConnectionSelector,
        client_protocol_version: u16,
    ) -> Result<ConnectionSummary, ErrorCode> {
        match selector {
            ConnectionSelector::Current | ConnectionSelector::Id(_) => {
                let authority =
                    terminal_authority_for_selector(session, selector, client_protocol_version)?;
                self.services()?
                    .connections
                    .terminal_summary(&authority)
                    .await
                    .map(|summary| connection_summary(&summary))
                    .map_err(|_| ErrorCode::ScopeDenied)
            }
            ConnectionSelector::Name(name) => {
                let services = self.services()?;
                let authority = terminal_authority(session, client_protocol_version);
                let current = services
                    .connections
                    .terminal_summary(&authority)
                    .await
                    .map_err(|_| ErrorCode::ScopeDenied)?;
                let resolved = services
                    .connections
                    .resolve_terminal_cli(&authority, name)
                    .await
                    .map_err(map_application_error)?;
                match resolved {
                    Ok(resolved) if resolved.id == current.id => Ok(connection_summary(&resolved)),
                    Ok(_) => Err(ErrorCode::ScopeDenied),
                    Err(CliConnectionResolutionError::NoMatch)
                    | Err(CliConnectionResolutionError::Ambiguous { .. }) => {
                        Err(ErrorCode::InvalidRequest)
                    }
                }
            }
        }
    }

    async fn connection_test(
        &self,
        session: &AuthenticatedSession,
        arguments: &ConnectionSelectorArguments,
        client_protocol_version: u16,
    ) -> Result<ConnectionTestResult, ErrorCode> {
        let connection = self
            .resolve_connection(session, &arguments.connection, client_protocol_version)
            .await?;
        let authority = terminal_authority_for_selector(
            session,
            &arguments.connection,
            client_protocol_version,
        )?;
        let services = self.services()?;
        services
            .connections
            .test_terminal(&authority)
            .await
            .map_err(map_target_error)?;
        Ok(ConnectionTestResult {
            connection,
            reachable: true,
        })
    }

    pub(super) async fn catalog(
        &self,
        session: &AuthenticatedSession,
        arguments: &CatalogArguments,
        client_protocol_version: u16,
    ) -> Result<CatalogSnapshot, ErrorCode> {
        self.resolve_connection(session, &arguments.connection, client_protocol_version)
            .await?;
        let authority = terminal_authority_for_selector(
            session,
            &arguments.connection,
            client_protocol_version,
        )?;
        if let Some(database) = &arguments.database {
            self.services()?
                .catalog
                .load_terminal_database_snapshot(&authority, database.clone())
                .await
                .map_err(map_application_error)
        } else {
            self.services()?
                .catalog
                .load_terminal_snapshot(&authority, CatalogReadPolicy::CacheFirst)
                .await
                .map_err(map_application_error)
        }
    }

    async fn database_list(
        &self,
        session: &AuthenticatedSession,
        connection_selector: &ConnectionSelector,
        client_protocol_version: u16,
    ) -> Result<DatabaseListResult, ErrorCode> {
        let connection = self
            .resolve_connection(session, connection_selector, client_protocol_version)
            .await?;
        let authority =
            terminal_authority_for_selector(session, connection_selector, client_protocol_version)?;
        let databases = self
            .services()?
            .catalog
            .list_terminal_databases(&authority)
            .await
            .map_err(map_application_error)?
            .into_iter()
            .map(|database| ProtocolDatabaseSummary {
                name: database.name,
                is_default: database.is_default,
            })
            .collect();
        Ok(DatabaseListResult {
            connection_id: connection.id,
            databases,
        })
    }

    async fn catalog_search(
        &self,
        session: &AuthenticatedSession,
        arguments: CatalogSearchArguments,
        client_protocol_version: u16,
    ) -> Result<CatalogSearchResult, ErrorCode> {
        let query = arguments.query.trim();
        let limit = arguments.limit.unwrap_or(20);
        if query.is_empty()
            || query.len() > MAX_CATALOG_SEARCH_QUERY_BYTES
            || query.chars().any(char::is_control)
            || arguments.kinds.len() > MAX_CATALOG_SEARCH_KINDS
            || limit == 0
            || limit > MAX_CATALOG_SEARCH_MATCHES
        {
            return Err(ErrorCode::InvalidRequest);
        }

        // Search while the canonical snapshot is still inside the Desktop runtime.
        // Only compact object references cross the Broker frame, so schemas with many
        // columns cannot turn a bounded Agent lookup into an oversized response.
        let catalog = self
            .catalog(
                session,
                &CatalogArguments {
                    connection: arguments.connection,
                    database: arguments.database,
                },
                client_protocol_version,
            )
            .await?;
        let needle = query.to_lowercase();
        let mut matches = Vec::<CatalogSearchCandidate>::new();

        for relation in catalog.relations() {
            if !kind_allowed(relation.object.kind, &arguments.kinds) {
                continue;
            }
            let qualified_name = qualified_name(&relation.object);
            let searchable = relation
                .columns
                .iter()
                .map(|column| column.name.as_str())
                .chain(relation.comment.as_deref())
                .collect::<Vec<_>>();
            if let Some(score) =
                search_score(&needle, &relation.object.name, &qualified_name, &searchable)
            {
                matches.push(CatalogSearchCandidate {
                    score,
                    label: qualified_name.clone(),
                    value: CatalogSearchMatch {
                        match_type: CatalogSearchMatchType::Relation,
                        qualified_name,
                        object: relation.object.clone(),
                        matched_fields: matching_fields(
                            &needle,
                            relation.columns.iter().map(|column| column.name.as_str()),
                        ),
                    },
                });
            }
        }

        for routine in catalog.routines() {
            if !kind_allowed(routine.object.kind, &arguments.kinds) {
                continue;
            }
            let qualified_name = qualified_name(&routine.object);
            let searchable = routine
                .arguments
                .iter()
                .map(String::as_str)
                .chain(routine.comment.as_deref())
                .chain(routine.detail.as_deref())
                .collect::<Vec<_>>();
            if let Some(score) =
                search_score(&needle, &routine.object.name, &qualified_name, &searchable)
            {
                matches.push(CatalogSearchCandidate {
                    score,
                    label: qualified_name.clone(),
                    value: CatalogSearchMatch {
                        match_type: CatalogSearchMatchType::Routine,
                        qualified_name,
                        object: routine.object.clone(),
                        matched_fields: matching_fields(
                            &needle,
                            routine.arguments.iter().map(String::as_str),
                        ),
                    },
                });
            }
        }

        for object in catalog.other_objects() {
            if !kind_allowed(object.object.kind, &arguments.kinds) {
                continue;
            }
            let qualified_name = qualified_name(&object.object);
            let searchable = object
                .comment
                .as_deref()
                .into_iter()
                .chain(object.detail.as_deref())
                .collect::<Vec<_>>();
            if let Some(score) =
                search_score(&needle, &object.object.name, &qualified_name, &searchable)
            {
                matches.push(CatalogSearchCandidate {
                    score,
                    label: qualified_name.clone(),
                    value: CatalogSearchMatch {
                        match_type: CatalogSearchMatchType::Object,
                        qualified_name,
                        object: object.object.clone(),
                        matched_fields: Vec::new(),
                    },
                });
            }
        }

        matches.sort_by(|left, right| {
            left.score
                .cmp(&right.score)
                .then_with(|| left.label.cmp(&right.label))
        });
        let total_matches = u64::try_from(matches.len()).unwrap_or(u64::MAX);
        let matches = matches
            .into_iter()
            .take(usize::try_from(limit).unwrap_or(usize::MAX))
            .map(|candidate| candidate.value)
            .collect::<Vec<_>>();

        Ok(CatalogSearchResult {
            connection_id: catalog.connection_id(),
            engine: catalog.engine(),
            database: catalog.database().to_owned(),
            captured_at: catalog.captured_at(),
            fingerprint: catalog.fingerprint().to_owned(),
            query: arguments.query,
            total_matches,
            truncated: total_matches > u64::try_from(matches.len()).unwrap_or(u64::MAX),
            matches,
        })
    }

    async fn schema_list(
        &self,
        session: &AuthenticatedSession,
        arguments: &CatalogArguments,
        client_protocol_version: u16,
    ) -> Result<SchemaListResult, ErrorCode> {
        let catalog = self
            .catalog(session, arguments, client_protocol_version)
            .await?;
        let mut counts = BTreeMap::<String, [u64; 3]>::new();
        for namespace in catalog.namespaces() {
            counts.entry(namespace.name.clone()).or_default();
        }
        for relation in catalog.relations() {
            counts
                .entry(namespace_name(&relation.object.namespace))
                .or_default()[0] += 1;
        }
        for routine in catalog.routines() {
            counts
                .entry(namespace_name(&routine.object.namespace))
                .or_default()[1] += 1;
        }
        for object in catalog.other_objects() {
            counts
                .entry(namespace_name(&object.object.namespace))
                .or_default()[2] += 1;
        }
        Ok(SchemaListResult {
            connection_id: catalog.connection_id(),
            database: catalog.database().to_owned(),
            schemas: counts
                .into_iter()
                .map(|(name, counts)| SchemaSummary {
                    name,
                    relation_count: counts[0],
                    routine_count: counts[1],
                    object_count: counts[2],
                })
                .collect(),
        })
    }

    async fn table_describe(
        &self,
        session: &AuthenticatedSession,
        arguments: &TableDescribeArguments,
        client_protocol_version: u16,
    ) -> Result<TableDescribeResult, ErrorCode> {
        if arguments.table.is_empty()
            || arguments.table.len() > MAX_TABLE_SELECTOR_BYTES
            || arguments.table.chars().any(char::is_control)
        {
            return Err(ErrorCode::InvalidRequest);
        }
        let catalog = self
            .catalog(
                session,
                &CatalogArguments {
                    connection: arguments.connection.clone(),
                    database: arguments.database.clone(),
                },
                client_protocol_version,
            )
            .await?;
        let relation = if let Some((namespace, name)) = arguments.table.rsplit_once('.') {
            catalog
                .relations()
                .iter()
                .find(|relation| {
                    relation.object.namespace.as_deref() == Some(namespace)
                        && relation.object.name == name
                })
                .cloned()
                .ok_or(ErrorCode::InvalidRequest)?
        } else {
            let matches = catalog
                .relations()
                .iter()
                .filter(|relation| relation.object.name == arguments.table)
                .collect::<Vec<_>>();
            match matches.as_slice() {
                [relation] => (*relation).clone(),
                _ => return Err(ErrorCode::InvalidRequest),
            }
        };
        Ok(TableDescribeResult {
            connection_id: catalog.connection_id(),
            database: catalog.database().to_owned(),
            relation,
        })
    }
}

struct CatalogSearchCandidate {
    score: u8,
    label: String,
    value: CatalogSearchMatch,
}

fn kind_allowed(
    kind: dopedb_protocol::ObjectKind,
    allowed: &[dopedb_protocol::ObjectKind],
) -> bool {
    allowed.is_empty() || allowed.contains(&kind)
}

fn qualified_name(object: &dopedb_protocol::ObjectRef) -> String {
    [
        object.catalog.as_deref(),
        object.namespace.as_deref(),
        Some(&object.name),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(".")
}

fn search_score(needle: &str, name: &str, qualified: &str, extras: &[&str]) -> Option<u8> {
    if needle == "*" {
        return Some(5);
    }
    let name = name.to_lowercase();
    let qualified = qualified.to_lowercase();
    if name == needle || qualified == needle {
        return Some(0);
    }
    if name.starts_with(needle) {
        return Some(1);
    }
    if name.contains(needle) || qualified.contains(needle) {
        return Some(2);
    }
    if extras.iter().any(|value| value.to_lowercase() == needle) {
        return Some(3);
    }
    extras
        .iter()
        .any(|value| value.to_lowercase().contains(needle))
        .then_some(4)
}

#[cfg(test)]
pub(super) fn assert_catalog_search_contract() {
    assert_eq!(
        search_score("*", "users", "app.public.users", &["deleted_at"]),
        Some(5)
    );
    assert_eq!(
        search_score("user", "users", "app.public.users", &["deleted_at"]),
        Some(1)
    );
}

fn matching_fields<'a>(needle: &'a str, fields: impl Iterator<Item = &'a str>) -> Vec<String> {
    fields
        .filter(|field| field.to_lowercase().contains(needle))
        .take(12)
        .map(str::to_owned)
        .collect()
}
