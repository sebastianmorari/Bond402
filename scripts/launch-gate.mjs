import { spawnSync } from "node:child_process";

const checks = [
  ["typecheck", "Typecheck"],
  ["test:security-signals", "Security signals"],
  ["test:service-safety", "Service safety"],
  ["test:public-external-discovery", "External discovery"],
  ["test:public-external-detail", "External detail parsing"],
  ["test:public-external-routes", "External route safety"],
  ["test:service-registration", "Service registration"],
  ["test:response-mode", "Response modes"],
  ["test:trust-metrics", "Trust metrics"],
  ["test:trust-score", "Trust score"],
  ["test:service-ui", "Service UI"],
  ["test:domain-verification", "Domain verification"],
  ["test:public-catalog-schema", "Public catalog schema"],
  ["test:public-service-search", "Public service search"],
  ["test:protected-api", "Protected API"],
  ["test:auth-session", "Auth session"],
  ["test:database-resilience", "Database resilience"],
  ["test:backup-restore", "Backup and restore"],
  ["test:secret-leak", "Secret leak scan"],
  ["test:service-routes", "Service routes"],
  ["test:public-mvp", "Public MVP"],
  ["build", "Workspace build"],
  ["test:frontend-smoke", "Frontend smoke"],
  ["test:frontend-seo", "Frontend SEO"],
];

for (const [script, label] of checks) {
  console.log(`\n=== ${label}: pnpm run ${script} ===`);
  const result = spawnSync("pnpm", ["run", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`${label} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status ?? "unknown"}.`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nLaunch gate passed.");