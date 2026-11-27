import { defineConfig } from "drizzle-kit";

const databaseUrl = (process.env["DATABASE_URL"] ?? "").trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set in environment variables.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: {
    url: databaseUrl,
    ssl: { rejectUnauthorized: false },
  },
  verbose: true,
});
