/**
 * Standalone monitoring worker.
 * Run with: npm run monitor
 *
 * Requires MONGODB_URI and FIRECRAWL_API_KEY in .env.local or environment.
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();
import { runMonitorCycle } from "../src/lib/services/monitor";

async function main() {
  console.log("Starting VendorWatch monitoring cycle...");
  const results = await runMonitorCycle();
  console.log(`Completed. Processed ${results.length} vendor(s):`);
  for (const r of results) {
    console.log(`  - ${r.vendorName}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
