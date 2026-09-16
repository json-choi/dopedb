// Renders engine brand marks with shared sizing and accessible engine names.

import mysqlIcon from "../assets/db-icons/mysql.svg";
import mongodbIcon from "../assets/db-icons/mongodb.svg";
import postgresqlIcon from "../assets/db-icons/postgresql.svg";
import sqliteIcon from "../assets/db-icons/sqlite.svg";
import GoogleBigQueryIcon from "@iconify-react/simple-icons/googlebigquery";
import type { Engine } from "../ipc/types";

const ENGINE_ICON: Record<Exclude<Engine, "bigquery">, string> = {
  postgres: postgresqlIcon,
  mysql: mysqlIcon,
  sqlite: sqliteIcon,
  mongodb: mongodbIcon,
};

const ENGINE_LABEL: Record<Engine, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  mongodb: "MongoDB",
  bigquery: "Google BigQuery",
};

export default function EngineMark({
  engine,
  size = "control",
}: {
  engine: Engine;
  size?: "control" | "tree";
}) {
  const label = ENGINE_LABEL[engine];
  return (
    <span
      className={
        size === "tree"
          ? "ds-engine-mark tw:size-4 tw:min-w-4"
          : "ds-engine-mark"
      }
      data-engine={engine}
      data-size={size}
      title={label}
      aria-label={label}
    >
      {engine === "bigquery" ? (
        <GoogleBigQueryIcon aria-hidden="true" />
      ) : (
        <img
          src={ENGINE_ICON[engine]}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      )}
    </span>
  );
}
