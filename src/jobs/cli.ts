import { sql } from "@/db";
import { runAll } from "./engine";

async function main() {
  const result = await runAll("cli");
  console.table(result);
  await sql.end();
}
main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
