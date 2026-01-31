/**
 * Plan tiers and vendor (site) limits for companies.
 */

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

/** In-memory plan override (demo only). Resets on server restart. */
let planOverride: PlanId | null = null;

export function setPlanOverride(plan: PlanId | null): void {
  planOverride = plan;
}

/** Plan from override, then env VENDORWATCH_PLAN. Defaults to basic. */
export function getCurrentPlan(): PlanId {
  if (planOverride) return planOverride;
  const raw = process.env.VENDORWATCH_PLAN?.toLowerCase().trim();
  if (raw && (raw === "basic" || raw === "premium" || raw === "enterprise")) {
    return raw;
  }
  return "basic";
}

/** Max vendors (sites) allowed for the current plan. */
export function getVendorLimit(): number {
  return PLAN_LIMITS[getCurrentPlan()];
}
