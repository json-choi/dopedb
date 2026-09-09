import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/sqlite-core";

// Store one UTC representation so lexical SQL comparisons match Date ordering.
export const utcDate = customType<{ data: Date; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => value.toISOString(),
  fromDriver: (value) => {
    const date = new Date(value);
    if (!Number.isFinite(date.valueOf())) throw new Error("Invalid stored UTC date");
    return date;
  },
});

// D1 exposes SQLite integers as JavaScript numbers. Refuse lossy round trips.
export const integerBigInt = customType<{ data: bigint; driverData: number }>({
  dataType: () => "integer",
  toDriver: (value) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || BigInt(number) !== value) {
      throw new Error("Workspace integer exceeds the exact D1 range");
    }
    return number;
  },
  fromDriver: (value) => {
    if (!Number.isSafeInteger(value)) throw new Error("Inexact stored Workspace integer");
    return BigInt(value);
  },
});

export const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
export const uuidDefault = sql`(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6))))`;
