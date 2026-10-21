// Renders engine brand marks with shared sizing and accessible engine names.

import mysqlIcon from "../assets/db-icons/mysql.svg";
import mongodbIcon from "../assets/db-icons/mongodb.svg";
import postgresqlIcon from "../assets/db-icons/postgresql.svg";
import sqliteIcon from "../assets/db-icons/sqlite.svg";
import bigqueryIcon from "../assets/db-icons/googlebigquery.svg";
import cloudflareIcon from "../assets/db-icons/cloudflare.svg";
import type { Engine, Provider } from "../ipc/types";

const ENGINE_ICON: Record<Engine, string> = {
  bigquery: bigqueryIcon,
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
  provider,
  size = "control",
}: {
  engine: Engine;
  provider?: Provider;
  size?: "control" | "tree";
}) {
  const cloudflare = engine === "sqlite" && provider === "cloudflareD1";
  const label = cloudflare ? "Cloudflare D1" : ENGINE_LABEL[engine];
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
      <img
        src={cloudflare ? cloudflareIcon : ENGINE_ICON[engine]}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    </span>
  );
}
