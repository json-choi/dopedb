//! Optional live-MySQL coverage of both Agent and Article read-only boundaries.
//! Set DOPEDB_TEST_MYSQL_PORT to an isolated loopback MySQL server with an empty
//! root password. The fixture owns one fresh database and never changes users.

use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::{AssertSqlSafe, Executor, SqlSafeStr};

use super::{run_read_only_byte_capped_cancellable, run_read_only_cancellable, PoolRef};
use crate::error::AppError;

pub(super) async fn assert_read_boundary_if_configured() {
    let Some(port) = std::env::var_os("DOPEDB_TEST_MYSQL_PORT") else {
        return;
    };
    let port: u16 = port.to_str().expect("MySQL test port").parse().unwrap();
    let options = MySqlConnectOptions::new()
        .host("127.0.0.1")
        .port(port)
        .username("root")
        .ssl_mode(MySqlSslMode::Disabled);
    let admin = MySqlPoolOptions::new()
        .max_connections(1)
        .connect_with(options.clone())
        .await
        .unwrap();
    let database = format!("dopedb_l2_{}", uuid::Uuid::new_v4().simple());
    admin
        .execute(AssertSqlSafe(format!("CREATE DATABASE `{database}`")).into_sql_str())
        .await
        .unwrap();
    // A writable session default proves the per-request transaction enforces
    // read-only independently of the production pool's additional protection.
    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect_with(options.database(&database))
        .await
        .unwrap();
    pool.execute("CREATE TABLE probe (id INT PRIMARY KEY)")
        .await
        .unwrap();
    pool.execute("INSERT INTO probe VALUES (1), (2), (3)")
        .await
        .unwrap();

    for article in [false, true] {
        for (sql, max_rows, expected_rows, truncated) in [
            ("SELECT id FROM probe ORDER BY id", 10, 3, false),
            ("SELECT id FROM probe ORDER BY id", 2, 2, true),
            ("SELECT id FROM probe WHERE 1 = 0", 10, 0, false),
        ] {
            let result = if article {
                run_read_only_byte_capped_cancellable(
                    PoolRef::Mysql(&pool),
                    sql,
                    max_rows,
                    64 * 1024,
                    None,
                )
                .await
            } else {
                run_read_only_cancellable(PoolRef::Mysql(&pool), sql, max_rows, None).await
            }
            .unwrap();
            assert_eq!(result.row_count, expected_rows);
            assert_eq!(result.truncated, truncated);
            assert_eq!(result.columns, ["id"]);
        }

        let refused = if article {
            run_read_only_byte_capped_cancellable(
                PoolRef::Mysql(&pool),
                "INSERT INTO probe VALUES (4)",
                10,
                64 * 1024,
                None,
            )
            .await
        } else {
            run_read_only_cancellable(
                PoolRef::Mysql(&pool),
                "INSERT INTO probe VALUES (4)",
                10,
                None,
            )
            .await
        };
        assert!(matches!(refused, Err(AppError::Blocked { .. })));
        assert!(run_read_only_cancellable(
            PoolRef::Mysql(&pool),
            "SELECT missing_column FROM probe",
            10,
            None,
        )
        .await
        .is_err());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM probe")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 3, "a refused read must never change data");
        let open: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM information_schema.innodb_trx \
             WHERE trx_mysql_thread_id = CONNECTION_ID()",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(open, 0, "an abandoned read must not leave a transaction");
    }
    pool.close().await;
    admin
        .execute(AssertSqlSafe(format!("DROP DATABASE `{database}`")).into_sql_str())
        .await
        .unwrap();
    admin.close().await;
}
