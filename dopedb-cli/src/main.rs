mod agent_mcp;
mod args;
mod client;
mod commands;
mod exit_code;
mod output;
mod schema_diff;

use std::process::ExitCode;

use clap::Parser;

use args::{
    AgentCommand, AppCommand, CatalogCommand, Cli, Command, ConnectionCommand, DatabaseCommand,
    DocumentCommand, OperationCommand, QueryCommand, SchemaCommand, SkillCommand, SkillsCommand,
    SqlCommand, TableCommand,
};
use output::OutputMode;

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let result = match cli.command {
        Command::Version(arguments) => {
            commands::app::version(OutputMode::from_json_flag(arguments.json)).await
        }
        Command::Status(arguments) => {
            commands::app::status(OutputMode::from_json_flag(arguments.json)).await
        }
        Command::Completion { shell } => commands::completion::write(shell),
        Command::App(arguments) => match arguments.command {
            AppCommand::Open { wait, output } => {
                commands::app::open(wait, OutputMode::from_json_flag(output.json)).await
            }
        },
        Command::Skills(arguments) => match arguments.command {
            SkillsCommand::List(output) => {
                commands::skills::list(OutputMode::from_json_flag(output.json))
            }
            SkillsCommand::Get { name, full, output } => {
                commands::skills::get(&name, full, OutputMode::from_json_flag(output.json))
            }
        },
        Command::Skill(arguments) => match arguments.command {
            SkillCommand::Status { target, output } => {
                commands::skills::status(target.into(), OutputMode::from_json_flag(output.json))
                    .await
            }
            SkillCommand::Install { target, output } => {
                commands::skills::install(target.into(), OutputMode::from_json_flag(output.json))
                    .await
            }
            SkillCommand::Repair { target, output } => {
                commands::skills::repair(target.into(), OutputMode::from_json_flag(output.json))
                    .await
            }
            SkillCommand::Remove { target, output } => {
                commands::skills::remove(target.into(), OutputMode::from_json_flag(output.json))
                    .await
            }
        },
        Command::Agent(arguments) => match arguments.command {
            AgentCommand::Init {
                provider,
                config,
                output,
            } => {
                commands::external_agent::init(
                    provider.into(),
                    &config,
                    OutputMode::from_json_flag(output.json),
                )
                .await
            }
            AgentCommand::Start { config, arguments } => {
                commands::external_agent::start(config.as_deref(), &arguments).await
            }
            AgentCommand::Mcp => agent_mcp::serve().await,
        },
        Command::Connection(arguments) => match arguments.command {
            ConnectionCommand::List(output) => {
                commands::connection::list(OutputMode::from_json_flag(output.json)).await
            }
            ConnectionCommand::Show { selector, output } => {
                commands::connection::show(&selector, OutputMode::from_json_flag(output.json)).await
            }
            ConnectionCommand::Test { selector, output } => {
                commands::connection::test(&selector, OutputMode::from_json_flag(output.json)).await
            }
        },
        Command::Database(arguments) => match arguments.command {
            DatabaseCommand::List { connection, output } => {
                commands::catalog::databases(&connection, OutputMode::from_json_flag(output.json))
                    .await
            }
        },
        Command::Catalog(arguments) => match arguments.command {
            CatalogCommand::Show {
                connection,
                database,
                output,
            } => {
                commands::catalog::show(
                    &connection,
                    database,
                    OutputMode::from_json_flag(output.json),
                )
                .await
            }
        },
        Command::Schema(arguments) => match arguments.command {
            SchemaCommand::Diff {
                baseline,
                target,
                baseline_database,
                target_database,
                output,
            } => {
                commands::catalog::diff(
                    &baseline,
                    &target,
                    baseline_database,
                    target_database,
                    OutputMode::from_json_flag(output.json),
                )
                .await
            }
            SchemaCommand::List {
                connection,
                database,
                output,
            } => {
                commands::catalog::schemas(
                    &connection,
                    database,
                    OutputMode::from_json_flag(output.json),
                )
                .await
            }
        },
        Command::Table(arguments) => match arguments.command {
            TableCommand::Describe {
                table,
                connection,
                database,
                output,
            } => {
                commands::catalog::describe(
                    &connection,
                    database,
                    table,
                    OutputMode::from_json_flag(output.json),
                )
                .await
            }
        },
        Command::Document(arguments) => match arguments.command {
            DocumentCommand::Run {
                connection,
                file,
                max_rows,
                output,
            } => {
                commands::document::run(
                    &connection,
                    &file,
                    max_rows,
                    OutputMode::from_json_flag(output.json),
                )
                .await
            }
        },
        Command::Query(arguments) => match arguments.command {
            QueryCommand::Plan {
                connection,
                database,
                file,
                max_rows,
                output,
            } => {
                commands::query::plan(
                    &connection,
                    database,
                    &file,
                    max_rows,
                    OutputMode::from_json_flag(output.json),
                )
                .await
            }
            QueryCommand::Run { plan, output } => {
                commands::query::run(&plan, OutputMode::from_json_flag(output.json)).await
            }
            QueryCommand::Cancel {
                operation_id,
                output,
            } => {
                commands::query::cancel(&operation_id, OutputMode::from_json_flag(output.json))
                    .await
            }
        },
        Command::Sql(arguments) => match arguments.command {
            SqlCommand::Propose {
                connection,
                database,
                file,
                output,
            } => {
                commands::query::propose(
                    &connection,
                    database,
                    &file,
                    OutputMode::from_json_flag(output.json),
                )
                .await
            }
        },
        Command::Operation(arguments) => match arguments.command {
            OperationCommand::Show {
                operation_id,
                output,
            } => {
                commands::operation::show(&operation_id, OutputMode::from_json_flag(output.json))
                    .await
            }
            OperationCommand::Wait {
                operation_id,
                timeout_ms,
                output,
            } => {
                commands::operation::wait(
                    &operation_id,
                    timeout_ms,
                    OutputMode::from_json_flag(output.json),
                )
                .await
            }
            OperationCommand::Cancel {
                operation_id,
                output,
            } => {
                commands::operation::cancel(&operation_id, OutputMode::from_json_flag(output.json))
                    .await
            }
        },
    };
    match result {
        Ok(()) => ExitCode::from(exit_code::SUCCESS),
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(exit_code::for_client_error(&error))
        }
    }
}
