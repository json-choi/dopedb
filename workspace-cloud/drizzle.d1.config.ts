import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/d1/schema/index.ts",
  out: "./d1-migrations",
  strict: true,
});
