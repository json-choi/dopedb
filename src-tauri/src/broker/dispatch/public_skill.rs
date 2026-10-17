//! Public runtime and skill-management broker handlers.
use super::*;

pub(super) async fn handle(
    dispatcher: &BrokerDispatcher,
    request: &RequestEnvelope,
) -> ResponseEnvelope {
    let request_id = request.request_id;
    match request.command {
        CommandName::Version => dispatcher.execute_public::<VersionCommand>(
            request,
            VersionResult {
                app_version: dispatcher.app_version.into(),
                protocol_min: PROTOCOL_MIN,
                protocol_max: PROTOCOL_MAX,
                command_schema_version: COMMAND_SCHEMA_VERSION,
                runtime_id: dispatcher.runtime_id.into(),
            },
        ),
        CommandName::Status => dispatcher.execute_public::<StatusCommand>(
            request,
            StatusResult {
                app_version: dispatcher.app_version.into(),
                protocol_min: PROTOCOL_MIN,
                protocol_max: PROTOCOL_MAX,
                runtime_id: dispatcher.runtime_id.into(),
            },
        ),
        CommandName::AppOpen => {
            let arguments = match decode_arguments::<AppOpenCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            let _wait = arguments.wait;
            respond(request_id, dispatcher.focus_app())
        }
        CommandName::SkillsList => {
            if decode_arguments::<SkillsListCommand>(request).is_err() {
                return failure(request_id, ErrorCode::InvalidRequest, false);
            }
            respond(
                request_id,
                dispatcher
                    .skills
                    .as_ref()
                    .map(|skills| skills.list())
                    .ok_or(ErrorCode::PolicyBlocked),
            )
        }
        CommandName::SkillsGet => {
            let arguments = match decode_arguments::<SkillsGetCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .skills
                    .as_ref()
                    .ok_or(ErrorCode::PolicyBlocked)
                    .and_then(|skills| {
                        skills
                            .guide(&arguments.name, arguments.full)
                            .map_err(map_skill_error)
                    }),
            )
        }
        CommandName::SkillStatus => {
            let arguments = match decode_arguments::<SkillStatusCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            let Some(skills) = dispatcher.skills.clone() else {
                return failure(request_id, ErrorCode::PolicyBlocked, false);
            };
            let result = tokio::task::spawn_blocking(move || skills.status(arguments.target)).await;
            respond(
                request_id,
                result
                    .map_err(|_| ErrorCode::Internal)
                    .and_then(|result| result.map_err(map_skill_error)),
            )
        }
        CommandName::SkillInstall => Box::pin(install(dispatcher, request)).await,
        CommandName::SkillRepair => Box::pin(repair(dispatcher, request)).await,
        CommandName::SkillRemove => Box::pin(remove(dispatcher, request)).await,
        _ => failure(request_id, ErrorCode::InvalidRequest, false),
    }
}

async fn install(dispatcher: &BrokerDispatcher, request: &RequestEnvelope) -> ResponseEnvelope {
    let arguments = match decode_arguments::<SkillInstallCommand>(request) {
        Ok(arguments) => arguments,
        Err(_) => return failure(request.request_id, ErrorCode::InvalidRequest, false),
    };
    respond(
        request.request_id,
        dispatcher
            .run_skill_mutation(arguments, SkillMutation::Install)
            .await,
    )
}
async fn repair(dispatcher: &BrokerDispatcher, request: &RequestEnvelope) -> ResponseEnvelope {
    let arguments = match decode_arguments::<SkillRepairCommand>(request) {
        Ok(arguments) => arguments,
        Err(_) => return failure(request.request_id, ErrorCode::InvalidRequest, false),
    };
    respond(
        request.request_id,
        dispatcher
            .run_skill_mutation(arguments, SkillMutation::Repair)
            .await,
    )
}
async fn remove(dispatcher: &BrokerDispatcher, request: &RequestEnvelope) -> ResponseEnvelope {
    let arguments = match decode_arguments::<SkillRemoveCommand>(request) {
        Ok(arguments) => arguments,
        Err(_) => return failure(request.request_id, ErrorCode::InvalidRequest, false),
    };
    respond(
        request.request_id,
        dispatcher
            .run_skill_mutation(arguments, SkillMutation::Remove)
            .await,
    )
}

impl BrokerDispatcher {
    async fn run_skill_mutation(
        &self,
        arguments: SkillMutationArguments,
        mutation: SkillMutation,
    ) -> Result<dopedb_protocol::SkillMutationResult, ErrorCode> {
        let skills = self.skills.clone().ok_or(ErrorCode::PolicyBlocked)?;
        tokio::task::spawn_blocking(move || match mutation {
            SkillMutation::Install => skills.install(arguments),
            SkillMutation::Repair => skills.repair(arguments),
            SkillMutation::Remove => skills.remove(arguments),
        })
        .await
        .map_err(|_| ErrorCode::Internal)?
        .map_err(map_skill_error)
    }

    fn execute_public<C>(&self, request: &RequestEnvelope, result: C::Result) -> ResponseEnvelope
    where
        C: CommandSpec<Arguments = EmptyArguments>,
    {
        if decode_arguments::<C>(request).is_err() {
            return failure(request.request_id, ErrorCode::InvalidRequest, false);
        }
        success(request.request_id, &result)
    }

    pub(super) fn focus_app(&self) -> Result<AppOpenResult, ErrorCode> {
        let app_handle = self.app_handle.as_ref().ok_or(ErrorCode::Internal)?;
        let window = app_handle
            .get_webview_window("main")
            .ok_or(ErrorCode::Internal)?;
        window.show().map_err(|_| ErrorCode::Internal)?;
        window.unminimize().map_err(|_| ErrorCode::Internal)?;
        window.set_focus().map_err(|_| ErrorCode::Internal)?;
        Ok(AppOpenResult {
            runtime_id: Some(self.runtime_id.into()),
            launched: false,
            ready: true,
        })
    }
}
