/**
 * SQLite 数据库连接与 Drizzle 自动迁移模块（docs/database/schema.md §3）。
 * 强制开启 WAL 模式、5 秒 busy_timeout、外键约束与增量回收（auto_vacuum = INCREMENTAL），
 * 关闭前主动执行 wal_checkpoint(TRUNCATE) 以保证数据落盘完整性。
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema.ts";

export type AppDb = BunSQLiteDatabase<typeof schema>;

export interface DatabaseHandle {
  sqlite: Database;
  db: AppDb;
  close: () => void;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIR = resolve(currentDir, "../../drizzle");

export function openDatabase(
  dbPath: string,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): DatabaseHandle {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath, { create: true });

  // Mandatory SQLite durability & concurrency settings (docs/database/schema.md §3)
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");
  sqlite.exec("PRAGMA auto_vacuum = INCREMENTAL;");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsDir });

  return {
    sqlite,
    db,
    close: () => {
      try {
        sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      } catch {
        // ignore for :memory: databases
      }
      sqlite.close();
    },
  };
}
