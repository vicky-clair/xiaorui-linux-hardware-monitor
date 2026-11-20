import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/repositories/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.LHM_DB_PATH ?? "./data/lhm.sqlite",
  },
});
