//! Concrete Desktop and hosted adapters for Analysis Articles.

mod desktop_read;
pub(in crate::features::analysis_articles) mod hosted;
mod scoped_authority;
mod sqlite;

#[cfg(test)]
pub(crate) use desktop_read::assert_exact_query_contract;
pub(crate) use desktop_read::DesktopAnalysisReadExecution;
#[cfg(test)]
pub(crate) use hosted::assert_hosted_article_contract;
pub(crate) use hosted::HostedAnalysisAuthority;
pub(crate) use scoped_authority::ScopedAnalysisAuthority;
pub(crate) use sqlite::SqliteAnalysisLocalRepository;
