//! Feature-owned application slices.
//!
//! Each feature keeps its domain rules and use cases independent from Tauri, SQLx,
//! and other platform adapters. This module is also the composition boundary that
//! wires concrete adapters into those use cases.

pub(crate) mod activity;
pub(crate) mod agents;
pub(crate) mod analysis_articles;
pub(crate) mod catalog;
pub(crate) mod connections;
pub(crate) mod documents;
pub(crate) mod erd;
pub(crate) mod jobs;
pub(crate) mod knowledge;
pub(crate) mod monitoring;
pub(crate) mod operation_control;
pub(crate) mod product_analytics;
pub(crate) mod providers;
pub(crate) mod queries;
pub(crate) mod safety_settings;
pub(crate) mod scripts;
pub(crate) mod sql_documents;
pub(crate) mod terminals;
pub(crate) mod workspaces;
