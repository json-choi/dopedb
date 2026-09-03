//! Concrete Desktop and hosted adapters for Analysis Articles.

mod desktop_read;
pub(in crate::features::analysis_articles) mod hosted;
mod sqlite;

#[cfg(test)]
pub(crate) use desktop_read::assert_exact_query_contract;
pub(crate) use desktop_read::DesktopAnalysisReadExecution;
#[cfg(test)]
pub(crate) use hosted::assert_hosted_mutation_error_contract;
pub(crate) use hosted::HostedAnalysisAuthority;
pub(crate) use sqlite::SqliteAnalysisLocalRepository;
