import { NextRequest, NextResponse } from "next/server";
import { getVendorsCollection } from "@/lib/db/models";
import type { PlanId } from "@/lib/config/plans";
import { getCurrentPlan, getVendorLimit, PLAN_LABELS, setPlanOverride } from "@/lib/config/plans";

export async function GET() {
  try {
    const vendorsCol = await getVendorsCollection();
    const used = await vendorsCol.countDocuments();
    const plan = getCurrentPlan();
    const limit = getVendorLimit();

    return NextResponse.json({
      plan,
      planLabel: PLAN_LABELS[plan],
      vendorLimit: limit,
      vendorsUsed: used,
      vendorsRemaining: Math.max(0, limit - used),
    });
  } catch (err) {
    console.error("GET /api/plan:", err);
    return NextResponse.json(
      { error: "Failed to fetch plan" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const plan = body?.plan?.toLowerCase?.()?.trim?.();
    if (plan !== "basic" && plan !== "premium" && plan !== "enterprise") {
      return NextResponse.json(
        { error: "Invalid plan. Use basic, premium, or enterprise." },
        { status: 400 }
      );
    }
    const planId = plan as PlanId;
    setPlanOverride(planId);
    const vendorsCol = await getVendorsCollection();
    const used = await vendorsCol.countDocuments();
    const limit = getVendorLimit();
    return NextResponse.json({
      plan: planId,
      planLabel: PLAN_LABELS[planId],
      vendorLimit: limit,
      vendorsUsed: used,
      vendorsRemaining: Math.max(0, limit - used),
    });
  } catch (err) {
    console.error("POST /api/plan:", err);
    return NextResponse.json(
      { error: "Failed to update plan" },
      { status: 500 }
    );
  }
}
