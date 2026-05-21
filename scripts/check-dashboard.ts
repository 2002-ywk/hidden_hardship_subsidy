import { referenceDataRepository } from "../src/server/repositories/referenceDataRepository";

function maskDatabaseUrl(value: string) {
  return value.replace(/(mysql:\/\/[^:]+:)[^@]+@/, "$1***@");
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (url) {
    console.log(`DATABASE_URL=${maskDatabaseUrl(url)}`);
  } else {
    console.log("DATABASE_URL is empty");
  }

  const data = await referenceDataRepository.getDashboardData();
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Dashboard fetch failed: ${message}`);
  process.exit(1);
});

