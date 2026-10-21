/**
 * PaaS hardware plans.
 *
 * Names and hardware come from Liara's docs page
 * https://docs.liara.ir/paas/details/plans/hardware-plans/ (verified via the
 * LiaraYar docs index). Plan IDs and Toman prices are NOT in the docs or the
 * OpenAPI spec: they are placeholders and marked `verified: false` (UNVERIFIED).
 * `RealLiaraClient.listPlans()` reads the live catalogue from `GET /v1/me` and
 * only falls back to this table if a field is missing.
 */
import type { Plan } from "./types";

export const FALLBACK_PLANS: Plan[] = [
  { id: "earth", labelFa: "زمین (اقتصادی)", cpu: 0.5, ramMb: 512, diskGb: 5, monthlyToman: 180_000, verified: false },
  { id: "mars", labelFa: "مریخ (اقتصادی پلاس)", cpu: 1, ramMb: 1024, diskGb: 10, monthlyToman: 350_000, verified: false },
  { id: "jupiter", labelFa: "مشتری (استاندارد)", cpu: 1, ramMb: 2048, diskGb: 20, monthlyToman: 650_000, verified: false },
  { id: "saturn", labelFa: "زحل (استاندارد پلاس)", cpu: 2, ramMb: 4096, diskGb: 40, monthlyToman: 1_250_000, verified: false },
  { id: "uranus", labelFa: "اورانوس (حرفه‌ای)", cpu: 4, ramMb: 8192, diskGb: 80, monthlyToman: 2_450_000, verified: false },
  { id: "neptune", labelFa: "نپتون (حرفه‌ای پلاس)", cpu: 8, ramMb: 16384, diskGb: 160, monthlyToman: 4_850_000, verified: false },
  { id: "pluto", labelFa: "پلوتون (اکستریم)", cpu: 16, ramMb: 32768, diskGb: 320, monthlyToman: 9_600_000, verified: false },
];

/** Placeholder monthly prices for add-ons (UNVERIFIED). */
export const ADDON_PRICES = {
  /** Per GB of extra disk per month. */
  diskPerGbToman: 3_000,
  /** Smallest managed database. */
  databaseSmallToman: 250_000,
  verified: false,
} as const;

export function findPlan(plans: Plan[], id: string): Plan | undefined {
  return plans.find((p) => p.id === id);
}

/** Smallest plan with at least `ramMb` of memory. */
export function smallestPlanWithRam(plans: Plan[], ramMb: number): Plan {
  const sorted = [...plans].sort((a, b) => a.ramMb - b.ramMb);
  return sorted.find((p) => p.ramMb >= ramMb) ?? sorted[sorted.length - 1]!;
}
