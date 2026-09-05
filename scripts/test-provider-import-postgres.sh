#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_database="dopedb_provider_import_${$}"
fixture_directory=""
fixture_port=""
admin_url="${PROVIDER_IMPORT_POSTGRES_ADMIN_URL:-}"
postgres_server_bin=""
fixture_database_created=0

if [[ ! "$fixture_database" =~ ^dopedb_provider_import_[0-9]+$ ]]; then
  echo "invalid provider import fixture database name" >&2
  exit 1
fi

cleanup_fixture() {
  local exit_status=$?
  if [[ "$exit_status" != "0" && -n "$fixture_directory" && -f "$fixture_directory/postgres.log" ]]; then
    echo "PostgreSQL fixture log (failure tail):" >&2
    tail -n 80 "$fixture_directory/postgres.log" >&2 || true
  fi
  if [[ "$fixture_database_created" = "1" ]]; then
    dropdb --if-exists --force --maintenance-db="$admin_url" "$fixture_database" \
      >/dev/null 2>&1 || true
  fi
  if [[ -n "$fixture_directory" ]]; then
    "$postgres_server_bin/pg_ctl" --pgdata="$fixture_directory/data" stop --mode=immediate \
      >/dev/null 2>&1 || true
    if [[ "$fixture_directory" == */dopedb-provider-import.* ]]; then
      rm -rf -- "$fixture_directory"
    fi
  fi
}
trap cleanup_fixture EXIT

if [[ -z "$admin_url" ]]; then
  if command -v postgres >/dev/null 2>&1; then
    postgres_server_bin="$(dirname "$(command -v postgres)")"
  elif [[ -x /opt/homebrew/opt/postgresql@18/bin/postgres ]]; then
    postgres_server_bin="/opt/homebrew/opt/postgresql@18/bin"
  elif [[ -x /opt/homebrew/opt/postgresql@17/bin/postgres ]]; then
    postgres_server_bin="/opt/homebrew/opt/postgresql@17/bin"
  else
    echo "PostgreSQL server binaries are required for the local fixture" >&2
    exit 1
  fi
  fixture_directory="$(mktemp -d "${TMPDIR:-/tmp}/dopedb-provider-import.XXXXXX")"
  "$postgres_server_bin/initdb" --auth=trust --no-locale --encoding=UTF8 \
    --pgdata="$fixture_directory/data" >/dev/null
  mkdir -p "$fixture_directory/socket"
  fixture_port="$(node -e '
    const net = require("node:net");
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write(String(server.address().port));
      server.close();
    });
    server.on("error", () => process.exit(1));
  ')"
  if [[ -z "$fixture_port" ]]; then
    echo "no free PostgreSQL fixture port" >&2
    exit 1
  fi
  "$postgres_server_bin/pg_ctl" --pgdata="$fixture_directory/data" \
    --log="$fixture_directory/postgres.log" \
    --options="-F -h 127.0.0.1 -p $fixture_port -k $fixture_directory/socket" \
    --wait start >/dev/null
  admin_url="postgresql://$(id -un)@127.0.0.1:${fixture_port}/postgres"
fi

createdb --maintenance-db="$admin_url" "$fixture_database"
fixture_database_created=1
test_url="$(node -e '
  const url = new URL(process.argv[1]);
  url.pathname = "/" + process.argv[2];
  url.search = "";
  process.stdout.write(url.toString());
' "$admin_url" "$fixture_database")"

DATABASE_URL="$test_url" DATABASE_URL_UNPOOLED="$test_url" \
  pnpm --dir "$repository_root/workspace-cloud" db:preflight

# Exercise the production entry point on a fresh database and on its existing
# baseline. A replaced migration lineage must stop before changing that database.
for migration_pass in 1 2; do
  VERCEL_ENV=production DATABASE_URL_UNPOOLED="$test_url" \
    pnpm --dir "$repository_root/workspace-cloud" db:migrate:production
done
migration_hash="$(psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="$test_url" \
  --tuples-only --no-align \
  --command='SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at LIMIT 1')"
if [[ ! "$migration_hash" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Workspace migration baseline was not recorded" >&2
  exit 1
fi
psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="$test_url" --quiet \
  --command="UPDATE drizzle.__drizzle_migrations SET hash = repeat('0', 64) WHERE hash = '$migration_hash'"
if migration_output="$(VERCEL_ENV=production DATABASE_URL_UNPOOLED="$test_url" \
  pnpm --dir "$repository_root/workspace-cloud" db:migrate:production 2>&1)"; then
  echo "Workspace production migration accepted an incompatible baseline" >&2
  exit 1
fi
if [[ "$migration_output" != *MIGRATION_BASELINE_MISMATCH* ]]; then
  echo "Workspace production migration omitted its baseline diagnostic" >&2
  exit 1
fi
psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="$test_url" --quiet \
  --command="DO \$\$ BEGIN
    IF (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at LIMIT 1) <> repeat('0', 64) THEN
      RAISE EXCEPTION 'Rejected migration changed the recorded baseline';
    END IF;
  END \$\$" \
  --command="UPDATE drizzle.__drizzle_migrations SET hash = '$migration_hash' WHERE hash = repeat('0', 64)"
echo "Workspace migration fresh/replay/incompatible-baseline checks passed"

sentinel="provider-import-${fixture_database}-isolated"
psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="$test_url" --quiet \
  --command='CREATE SCHEMA "provider_harness"' \
  --command='CREATE TABLE "provider_harness"."isolated_database_sentinel" ("marker" text PRIMARY KEY)' \
  --command="INSERT INTO \"provider_harness\".\"isolated_database_sentinel\" (\"marker\") VALUES ('$sentinel')"

PROVIDER_IMPORT_TEST_DATABASE_URL="$test_url" \
PROVIDER_IMPORT_TEST_DATABASE_ISOLATED=1 \
PROVIDER_IMPORT_TEST_DATABASE_SENTINEL="$sentinel" \
  pnpm --dir "$repository_root/workspace-cloud" test:postgres-import

echo "provider import PostgreSQL concurrency fixture ok"
