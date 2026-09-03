# Analysis Articles

## Use the Project-resource-pinned Agent bridge

An Analysis Article is ordinary sanitized HTML plus one bounded read-only saved
query. The HTML is the document; the query can be run again manually when the
user needs current data. It is not an always-on database tool.

When built-in AI Chat or `dopedb agent start` supplies the session-scoped DopeDB
MCP server, use its typed Analysis Article tools. Do not run `dopedb status`,
list connections, load this Skill again, or invoke the public CLI inside that
session.

1. Use `analysis_article_list` to inspect existing Articles in the exact pinned
   exact selected Project resource set when relevant.
2. Supply the exact selected database `connectionId`, a short title, safe
   semantic HTML, and exactly one bounded read-only query with its declared
   result columns. Use that same database's declared role.
3. Call `analysis_article_verify` to validate and execute that definition
   through the same exact-grant read runtime.
4. After successful verification, use `analysis_article_propose` to create and
   share a new Article, or `analysis_article_update` with the exact expected
   revision.

The Agent cannot schedule refreshes, share query rows, or publish/revoke the
external HTML page. Those actions remain outside the Agent; reruns and publishing
are explicit Desktop controls.

## Without an approved Agent session

The public `dopedb` CLI intentionally has no Analysis Article creation command.
Ask the user to use the target Project in built-in AI Chat or initialize and
start its secret-free external Agent config. Never substitute a generic MCP
server, direct database credentials, or an old query-run identifier.
