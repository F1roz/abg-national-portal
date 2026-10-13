import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://abg:abg@localhost:5432/abg_portal");
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await sql.end();
  console.log("Database schema dropped and recreated.");
}
main();
