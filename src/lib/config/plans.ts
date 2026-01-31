/** plan tiers and vendor limits */

export type PlanId = "basic" | "premium" | "enterprise";

export const PLAN_LIMITS: Record<PlanId, number> = {
  basic: 5,
  premium: 15,
  enterprise: 500,
};

export const PLAN_LABELS: Record<PlanId, string> = {
  basic: "Basic",
  premium: "Premium",
  enterprise: "Enterprise",
};

/** in-memory plan override, resets on restart */
let planOverride: PlanId | null = null;

export function setPlanOverride(plan: PlanId | null): void {
  planOverride = plan;
}

/** plan from override or env, defaults to basic */
export function getCurrentPlan(): PlanId {
  if (planOverride) return planOverride;
  const raw = process.env.VENDORWATCH_PLAN?.toLowerCase().trim();
  if (raw && (raw === "basic" || raw === "premium" || raw === "enterprise")) {
    return raw;
  }
  return "basic";
}

/** max vendors allowed for current plan */
export function getVendorLimit(): number {
  return PLAN_LIMITS[getCurrentPlan()];
}
