import { PrismaClient } from "@prisma/client";

async function main() {
  console.log(`node_timezone_offset_minutes=${new Date().getTimezoneOffset()}`);
  const baseUrl = process.env.DATABASE_URL ?? "";
  if (!baseUrl) {
    throw new Error("DATABASE_URL is empty");
  }
  const dbMatch = baseUrl.match(/\/([^/?]+)(\?|$)/);
  const targetDb = dbMatch ? decodeURIComponent(dbMatch[1]) : "";
  if (!targetDb) {
    throw new Error("Could not parse database name from DATABASE_URL");
  }
  const infoUrl = baseUrl.replace(/\/[^/?]+(\?|$)/, "/information_schema$1");
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: infoUrl,
      },
    },
  });

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      global_tz: string;
      session_tz: string;
      now_value: string;
      utc_now: string;
      diff: string;
      schema_exists: bigint;
    }>
  >(
    `
    SELECT
      @@global.time_zone AS global_tz,
      @@session.time_zone AS session_tz,
      NOW() AS now_value,
      UTC_TIMESTAMP() AS utc_now,
      TIMEDIFF(NOW(), UTC_TIMESTAMP()) AS diff,
      (
        SELECT COUNT(1)
        FROM information_schema.SCHEMATA
        WHERE SCHEMA_NAME = ?
      ) AS schema_exists
    `,
    targetDb
  );
  const row = rows[0] ?? null;
  if (row) {
    console.log(
      JSON.stringify(
        {
          ...row,
          schema_exists: Number(row.schema_exists),
        },
        null,
        2
      )
    );
  } else {
    console.log("null");
  }

  await prisma.$disconnect();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {});
