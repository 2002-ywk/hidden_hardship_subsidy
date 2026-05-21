function maskDatabaseUrl(value: string) {
  return value.replace(/(mysql:\/\/[^:]+:)[^@]+@/, "$1***@");
}

async function main() {
  await import("../src/server/db/client");
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    console.log("DATABASE_URL is empty");
    process.exit(1);
  }

  console.log(maskDatabaseUrl(url));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

