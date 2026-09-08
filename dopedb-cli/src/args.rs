use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(
    name = "dopedb",
    version,
    about = "Use the running DopeDB Desktop runtime"
)]
pub(crate) struct Cli {
    #[command(subcommand)]
    pub(crate) command: Command,
}

#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Show CLI and Desktop runtime protocol versions.
    Version(OutputArguments),
    /// Check whether the Desktop runtime is available.
    Status(OutputArguments),
    /// Generate a shell completion script without contacting the Desktop runtime.
    Completion {
        #[arg(value_enum)]
        shell: clap_complete::Shell,
    },
    /// Open or focus the DopeDB Desktop app.
    App(AppArguments),
    /// Read the version-matched embedded Skill guide.
    Skills(SkillsArguments),
    /// Inspect or manage the DopeDB Skill installation.
    Skill(SkillArguments),
    /// Configure and run an official AI CLI inside a Desktop-approved Project grant.
    Agent(AgentArguments),
    /// Inspect and test connection metadata in the active Terminal scope.
    Connection(ConnectionArguments),
    /// List databases reachable through one server connection.
    Database(DatabaseArguments),
    /// Load the canonical database catalog.
    Catalog(CatalogArguments),
    /// List namespaces or compare two authorized database schemas.
    Schema(SchemaArguments),
    /// Inspect one exact table or view.
    Table(TableArguments),
    /// Run one typed, read-only MongoDB document operation.
    Document(DocumentArguments),
    /// Plan, execute, or cancel a read-only query.
    Query(QueryArguments),
    /// Create an exact SQL operation proposal. This never approves it.
    Sql(SqlArguments),
    /// Inspect, wait for, or cancel a Terminal-owned operation.
    Operation(OperationArguments),
}

#[derive(Debug, Args)]
pub(crate) struct AgentArguments {
    #[command(subcommand)]
    pub(crate) command: AgentCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum AgentCommand {
    /// Choose Project resources in Desktop and create .dopedb/agent.json.
    Init {
        /// Official local AI CLI that will use this Project configuration.
        #[arg(long, value_enum)]
        provider: ExternalAgentProviderArgument,
        /// Secret-free configuration path, relative to the current Project root.
        #[arg(long, default_value = ".dopedb/agent.json")]
        config: PathBuf,
        #[command(flatten)]
        output: OutputArguments,
    },
    /// Ask Desktop to approve the config, then run the official Agent CLI.
    Start {
        /// Explicit config path; otherwise searches .dopedb/agent.json in parent directories.
        #[arg(long)]
        config: Option<PathBuf>,
        /// Arguments forwarded unchanged to the configured official AI CLI.
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        arguments: Vec<String>,
    },
    /// Session-scoped MCP entrypoint used only by `agent start`.
    #[command(hide = true)]
    Mcp,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub(crate) enum ExternalAgentProviderArgument {
    Codex,
    Claude,
}

impl From<ExternalAgentProviderArgument> for dopedb_protocol::ExternalAgentProvider {
    fn from(value: ExternalAgentProviderArgument) -> Self {
        match value {
            ExternalAgentProviderArgument::Codex => Self::Codex,
            ExternalAgentProviderArgument::Claude => Self::Claude,
        }
    }
}

#[derive(Debug, Args)]
pub(crate) struct AppArguments {
    #[command(subcommand)]
    pub(crate) command: AppCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum AppCommand {
    /// Focus the running Desktop app.
    Open {
        /// Wait until the Desktop window reports that it is ready.
        #[arg(long)]
        wait: bool,
        #[command(flatten)]
        output: OutputArguments,
    },
}

#[derive(Debug, Args)]
pub(crate) struct SkillsArguments {
    #[command(subcommand)]
    pub(crate) command: SkillsCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum SkillsCommand {
    /// List Skill guides embedded in this CLI.
    List(OutputArguments),
    /// Print one version-matched guide without contacting Desktop.
    Get {
        name: String,
        /// Include the reference documents after the main guide.
        #[arg(long)]
        full: bool,
        #[command(flatten)]
        output: OutputArguments,
    },
}

#[derive(Debug, Args)]
pub(crate) struct SkillArguments {
    #[command(subcommand)]
    pub(crate) command: SkillCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum SkillCommand {
    /// Inspect the bounded installation inventory.
    Status {
        #[arg(long, value_enum)]
        target: SkillTargetArgument,
        #[command(flatten)]
        output: OutputArguments,
    },
    /// Install or update only a missing or known managed snapshot.
    Install {
        #[arg(long, value_enum)]
        target: SkillTargetArgument,
        #[command(flatten)]
        output: OutputArguments,
    },
    /// Back up a conflict and explicitly replace it with the current stub.
    Repair {
        #[arg(long, value_enum)]
        target: SkillTargetArgument,
        #[command(flatten)]
        output: OutputArguments,
    },
    /// Remove only an exact known managed snapshot.
    Remove {
        #[arg(long, value_enum)]
        target: SkillTargetArgument,
        #[command(flatten)]
        output: OutputArguments,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub(crate) enum SkillTargetArgument {
    All,
    Codex,
    ClaudeCode,
}

impl From<SkillTargetArgument> for dopedb_protocol::SkillTargetSelection {
    fn from(value: SkillTargetArgument) -> Self {
        match value {
            SkillTargetArgument::All => Self::All,
            SkillTargetArgument::Codex => Self::Codex,
            SkillTargetArgument::ClaudeCode => Self::ClaudeCode,
        }
    }
}

#[derive(Debug, Clone, Copy, Args)]
pub(crate) struct OutputArguments {
    /// Emit stable machine-readable JSON on stdout.
    #[arg(long)]
    pub(crate) json: bool,
}

#[derive(Debug, Args)]
pub(crate) struct ConnectionArguments {
    #[command(subcommand)]
    pub(crate) command: ConnectionCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum ConnectionCommand {
    /// List secret-free connection summaries.
    List(OutputArguments),
    /// Show one exact connection summary.
    Show {
        selector: String,
        #[command(flatten)]
        output: OutputArguments,
    },
    /// Test the pinned connection without printing credentials.
    Test {
        selector: String,
        #[command(flatten)]
        output: OutputArguments,
    },
}

#[derive(Debug, Args)]
pub(crate) struct DatabaseArguments {
    #[command(subcommand)]
    pub(crate) command: DatabaseCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum DatabaseCommand {
    List {
        #[arg(long)]
        connection: String,
        #[command(flatten)]
        output: OutputArguments,
    },
}

#[derive(Debug, Args)]
pub(crate) struct CatalogArguments {
    #[command(subcommand)]
    pub(crate) command: CatalogCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum CatalogCommand {
    Show {
        #[arg(long)]
        connection: String,
        #[arg(long)]
        database: Option<String>,
        #[command(flatten)]
        output: OutputArguments,
    },
}

#[derive(Debug, Args)]
pub(crate) struct SchemaArguments {
    #[command(subcommand)]
    pub(crate) command: SchemaCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum SchemaCommand {
    /// Compare fresh catalogs. Added/missing are relative to the baseline.
    Diff {
        /// Baseline connection: id:<uuid>, name:<exact-name>, or current.
        #[arg(long)]
        baseline: String,
        /// Comparison connection, authorized by the same Desktop session.
        #[arg(long)]
        target: String,
        /// Exact baseline database; defaults to the connection's configured database.
        #[arg(long)]
        baseline_database: Option<String>,
        /// Exact target database; defaults to the connection's configured database.
        #[arg(long)]
        target_database: Option<String>,
        #[command(flatten)]
        output: OutputArguments,
    },
    List {
        #[arg(long)]
        connection: String,
        #[arg(long)]
        database: Option<String>,
        #[command(flatten)]
        output: OutputArguments,
    },
}

#[derive(Debug, Args)]
pub(crate) struct TableArguments {
    #[command(subcommand)]
    pub(crate) command: TableCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum TableCommand {
    Describe {
        table: String,
        #[arg(long)]
        connection: String,
        #[arg(long)]
        database: Option<String>,
        #[command(flatten)]
        output: OutputArguments,
    },
}

#[derive(Debug, Args)]
pub(crate) struct DocumentArguments {
    #[command(subcommand)]
    pub(crate) command: DocumentCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum DocumentCommand {
    /// Run one typed find, aggregate, or count request read from stdin as JSON.
    Run {
        #[arg(long)]
        connection: String,
        #[arg(long, value_name = "-")]
        file: String,
        #[arg(long)]
        max_rows: Option<u64>,
        #[command(flatten)]
        output: OutputArguments,
    },
}

#[derive(Debug, Args)]
pub(crate) struct QueryArguments {
    #[command(subcommand)]
    pub(crate) command: QueryCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum QueryCommand {
    /// Plan exactly one read-only SQL statement.
    Plan {
        #[arg(long)]
        connection: String,
        #[arg(long)]
        database: Option<String>,
        /// Read SQL from stdin. The first release accepts only `--file -`.
        #[arg(long, value_name = "-")]
        file: String,
        #[arg(long)]
        max_rows: Option<u64>,
        #[command(flatten)]
        output: OutputArguments,
    },
    /// Consume an exact single-use plan.
    Run {
        #[arg(long)]
        plan: String,
        #[command(flatten)]
        output: OutputArguments,
    },
    /// Cancel one Terminal-owned query operation.
    Cancel {
        operation_id: String,
        #[command(flatten)]
        output: OutputArguments,
    },
}

#[derive(Debug, Args)]
pub(crate) struct SqlArguments {
    #[command(subcommand)]
    pub(crate) command: SqlCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum SqlCommand {
    /// Create an immutable proposal. There is deliberately no approve command.
    Propose {
        #[arg(long)]
        connection: String,
        #[arg(long)]
        database: Option<String>,
        /// Read SQL from stdin. The first release accepts only `--file -`.
        #[arg(long, value_name = "-")]
        file: String,
        #[command(flatten)]
        output: OutputArguments,
    },
}

#[derive(Debug, Args)]
pub(crate) struct OperationArguments {
    #[command(subcommand)]
    pub(crate) command: OperationCommand,
}

#[derive(Debug, Subcommand)]
pub(crate) enum OperationCommand {
    Show {
        operation_id: String,
        #[command(flatten)]
        output: OutputArguments,
    },
    Wait {
        operation_id: String,
        #[arg(long, default_value_t = 30_000)]
        timeout_ms: u64,
        #[command(flatten)]
        output: OutputArguments,
    },
    Cancel {
        operation_id: String,
        #[command(flatten)]
        output: OutputArguments,
    },
}
