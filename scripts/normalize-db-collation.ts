import { prisma } from "@/src/server/db/client";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type TableRow = { TABLE_NAME: string };

function quoteId(id: string) {
  return `\`${id.replace(/`/g, "``")}\``;
}

async function main() {
  const [{ db }] = await prisma.$queryRawUnsafe<Array<{ db: string | null }>>("SELECT DATABASE() AS db");
  if (!db) {
    throw new Error("No active database selected (DATABASE() returned NULL). Check DATABASE_URL.");
  }

  const targetCharset = "utf8mb4";
  const targetCollation = "utf8mb4_unicode_ci";

  console.log(`Normalizing database collation for ${db} -> ${targetCharset}/${targetCollation}`);

  const tables = await prisma.$queryRawUnsafe<TableRow[]>(
    `
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `
  );

  const statements: string[] = [];
  statements.push(`ALTER DATABASE ${quoteId(db)} CHARACTER SET ${targetCharset} COLLATE ${targetCollation};`);

  for (const row of tables) {
    const table = row.TABLE_NAME;
    // CONVERT updates all textual columns' character set/collation under this table.
    const sql = `ALTER TABLE ${quoteId(table)} CONVERT TO CHARACTER SET ${targetCharset} COLLATE ${targetCollation};`;
    statements.push(sql);
  }

  const sqlScript = statements.join("\n");

  // Prisma Client uses the prepared statement protocol, and some DDL commands (ALTER DATABASE/TABLE)
  // are not supported under that protocol in MySQL. Use `prisma db execute` to run the DDL instead.
  const prismaBin =
    process.platform === "win32" ? ".\\node_modules\\.bin\\prisma.cmd" : "node_modules/.bin/prisma";

  const sqlFile = path.resolve(process.cwd(), "prisma", "normalize-collation.sql");
  fs.writeFileSync(sqlFile, sqlScript, "utf8");

  const prismaArgs = ["db", "execute", "--file", sqlFile, "--schema", "prisma/schema.prisma"];
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/c", prismaBin, ...prismaArgs], {
          stdio: "inherit",
          env: process.env,
        })
      : spawnSync(prismaBin, prismaArgs, { stdio: "inherit", env: process.env });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`prisma db execute failed with exit code ${result.status ?? "unknown"}`);
  }

  console.log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
