// Dataset IAM CLI support is allowlisted. The supported dataset access API
// preserves existing ACL entries and uses the dataset etag against races.
import { execFileSync } from "node:child_process";

const account = process.argv[2];
if (!account || process.argv.length !== 3) throw new Error("Pass the verified project account");
const project = "dopedb-503203";
const token = execFileSync("gcloud", ["auth", "print-access-token", `--account=${account}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${project}/datasets/product_analytics`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const current = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
if (!current.ok) throw new Error(`Dataset inspection failed: ${current.status}`);
const dataset = await current.json();
if (dataset.location !== "EU" || dataset.description !== "DopeDB opt-in Desktop product events") {
  throw new Error("Unexpected analytics dataset");
}
const entry = {
  role: `projects/${project}/roles/dopedbAnalyticsAppender`,
  userByEmail: `dopedb-analytics-ingest@${project}.iam.gserviceaccount.com`,
};
const access = dataset.access ?? [];
if (access.some((value) => value.userByEmail === entry.userByEmail)) {
  throw new Error("Analytics principal already has an ACL entry; inspect before changing it");
}
const result = await fetch(url, {
  method: "PATCH", headers: { ...headers, "if-match": dataset.etag },
  body: JSON.stringify({ access: [...access, entry] }), signal: AbortSignal.timeout(15000),
});
if (!result.ok) throw new Error(`Dataset ACL update failed: ${result.status}`);
console.log("Analytics dataset appender ACL installed");
