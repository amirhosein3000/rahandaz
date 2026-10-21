/**
 * Read-only smoke test against the real Liara API: proves the token works.
 * Only GET requests. Usage: pnpm smoke:liara  (reads LIARA_API_TOKEN from .env)
 */
import { RealLiaraClient } from "../src/real/rest";

const token = process.env.LIARA_API_TOKEN;
if (!token) {
  console.error("LIARA_API_TOKEN is not set. Put it in .env (never paste it in chat or commit it).");
  process.exit(2);
}

const client = new RealLiaraClient({
  apiToken: token,
  teamId: process.env.LIARA_TEAM_ID || undefined,
  baseUrl: process.env.LIARA_API_BASE_URL || undefined,
});

const maskEmail = (e?: string) => (e ? e.replace(/^(.).*(@.*)$/, "$1***$2") : "(unknown)");

try {
  const me = await client.whoami();
  console.log(`✓ token accepted: account ${maskEmail(me.email)}${me.teamId ? ` (team ${me.teamId})` : ""}`);
  const apps = await client.listApps();
  console.log(`✓ GET /v1/projects → ${apps.length} app(s)`);
  for (const a of apps) console.log(`  - ${a.name}  [${a.platform}]  status=${a.status}  plan=${a.planId}`);
  const plans = await client.listPlans();
  console.log(`✓ plans: ${plans.length} (${plans[0]?.verified ? "live catalogue from /v1/me" : "fallback table, UNVERIFIED"})`);
} catch (err) {
  console.error(`✗ smoke test failed: ${(err as Error).message}`);
  process.exit(1);
}
