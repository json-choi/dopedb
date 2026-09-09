import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

function literal(value: string) {
  return sql.raw("'" + value.replaceAll("'", "''") + "'");
}
function allowed(value: SQLWrapper, characters: string) {
  return sql`${value} NOT GLOB ${literal(`*[^${characters}]*`)}`;
}
function token(value: SQLWrapper, characters: string, min: number, max: number) {
  return sql`(length(${value}) BETWEEN ${sql.raw(String(min))} AND ${sql.raw(String(max))}
    AND ${allowed(value, characters)})`;
}
function first(value: SQLWrapper, characters: string) {
  return sql`substr(${value}, 1, 1) GLOB ${literal(`[${characters}]`)}`;
}

// Closed set of persisted identifier contracts; SQLite has no built-in REGEXP.
// This is schema construction, never a runtime regex-to-SQL translator.
export function matches(value: SQLWrapper, pattern: string): SQL {
  switch (pattern) {
    case "^[0-9a-f]{40}$": return token(value, "0-9a-f", 40, 40);
    case "^[0-9a-f]{64}$": return token(value, "0-9a-f", 64, 64);
    case "^[A-Z][A-Z0-9_]{0,95}$":
      return sql`(${token(value, "A-Z0-9_", 1, 96)} AND ${first(value, "A-Z")})`;
    case "^[A-Za-z0-9][A-Za-z0-9_-]{0,97}$":
      return sql`(${token(value, "A-Za-z0-9_-", 1, 98)} AND ${first(value, "A-Za-z0-9")})`;
    case "^[A-Za-z][A-Za-z0-9_-]{0,63}$":
      return sql`(${token(value, "A-Za-z0-9_-", 1, 64)} AND ${first(value, "A-Za-z")})`;
    case "^[a-z0-9][a-z0-9-]{0,59}$":
      return sql`(${token(value, "a-z0-9-", 1, 60)} AND ${first(value, "a-z0-9")})`;
    case "^[a-z0-9][a-z0-9-]{7,127}$":
      return sql`(${token(value, "a-z0-9-", 8, 128)} AND ${first(value, "a-z0-9")})`;
    case "^[a-z][a-z0-9-]{4,28}[a-z0-9]$":
      return sql`(${token(value, "a-z0-9-", 6, 30)} AND ${first(value, "a-z")}
        AND substr(${value}, -1) GLOB '[a-z0-9]')`;
    case "^v1\\.[A-Za-z0-9_-]{43}$":
      return sql`(substr(${value}, 1, 3) = 'v1.' AND ${token(sql`substr(${value}, 4)`, "A-Za-z0-9_-", 43, 43)})`;
    case "^v[1-9][0-9]*$":
      return sql`(length(${value}) >= 2 AND substr(${value}, 1, 1) = 'v'
        AND substr(${value}, 2, 1) GLOB '[1-9]' AND ${allowed(sql`substr(${value}, 2)`, "0-9")})`;
    case "^[A-Za-z0-9+/]+={0,2}$":
      return sql`(length(rtrim(${value}, '=')) >= 1
        AND length(${value}) - length(rtrim(${value}, '=')) <= 2
        AND ${allowed(sql`rtrim(${value}, '=')`, "A-Za-z0-9+/")})`;
    case "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$":
      return sql`(length(${value}) = 36 AND substr(${value}, 9, 1) = '-'
        AND substr(${value}, 14, 1) = '-' AND substr(${value}, 19, 1) = '-'
        AND substr(${value}, 24, 1) = '-' AND substr(${value}, 15, 1) GLOB '[1-8]'
        AND substr(${value}, 20, 1) GLOB '[89ab]'
        AND ${token(sql`replace(${value}, '-', '')`, "0-9a-f", 32, 32)})`;
    case "^projects/[A-Za-z0-9._:-]+/locations/[A-Za-z0-9_-]+/keyRings/[A-Za-z0-9_-]+/cryptoKeys/[A-Za-z0-9_-]+/cryptoKeyVersions/[1-9][0-9]*$": {
      // Allowed characters exclude quotes, making this JSON path split unambiguous.
      const safe = allowed(value, "A-Za-z0-9._:/-");
      const parts = sql`('[' || '"' || replace(${value}, '/', '","') || '"' || ']')`;
      const segment = (i: number) => sql`json_extract(${parts}, ${literal(`$[${i}]`)})`;
      return sql`(CASE WHEN ${safe} THEN json_array_length(${parts}) = 10
        AND ${segment(0)} = 'projects' AND ${segment(2)} = 'locations'
        AND ${segment(4)} = 'keyRings' AND ${segment(6)} = 'cryptoKeys'
        AND ${segment(8)} = 'cryptoKeyVersions'
        AND length(${segment(1)}) >= 1 AND ${allowed(segment(1), "A-Za-z0-9._:-")}
        AND length(${segment(3)}) >= 1 AND ${allowed(segment(3), "A-Za-z0-9_-")}
        AND length(${segment(5)}) >= 1 AND ${allowed(segment(5), "A-Za-z0-9_-")}
        AND length(${segment(7)}) >= 1 AND ${allowed(segment(7), "A-Za-z0-9_-")}
        AND length(${segment(9)}) >= 1 AND ${first(segment(9), "1-9")}
        AND ${allowed(segment(9), "0-9")} ELSE 0 END)`;
    }
    default: throw new Error("Unreviewed Workspace schema pattern");
  }
}

export function safeRelativePath(value: SQLWrapper): SQL {
  return sql`(substr(${value}, 1, 1) <> '/' AND instr(${value}, char(92)) = 0
    AND instr(${value}, '//') = 0 AND ${value} NOT IN ('.', '..')
    AND ${value} NOT LIKE './%' AND ${value} NOT LIKE '../%'
    AND ${value} NOT LIKE '%/./%' AND ${value} NOT LIKE '%/../%'
    AND ${value} NOT LIKE '%/.' AND ${value} NOT LIKE '%/..')`;
}
