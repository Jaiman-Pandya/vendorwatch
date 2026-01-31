import { NextRequest, NextResponse } from "next/server";
import { getRiskEventsCollection, getVendorsCollection } from "@/lib/db/models";
import { ObjectId } from "mongodb";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const vendorId = searchParams.get("vendorId");

    const riskEventsCol = await getRiskEventsCollection();
    const vendorsCol = await getVendorsCollection();

    const query = vendorId ? { vendorId: new ObjectId(vendorId) } : {};
    const events = await riskEventsCol
      .find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    // Resolve vendor names
    const vendorIds = [...new Set(events.map((e) => e.vendorId.toString()))];
    const vendors = await vendorsCol
      .find({ _id: { $in: vendorIds.map((id) => new ObjectId(id)) } })
      .toArray();
    const vendorMap = new Map(vendors.map((v) => [v._id!.toString(), v.name]));

    const serialized = events.map((e) => ({
      id: e._id?.toString(),
      vendorId: e.vendorId.toString(),
      vendor: vendorMap.get(e.vendorId.toString()) ?? "Unknown",
      severity: e.severity,
      type: e.type,
      summary: e.summary,
      recommendedAction: e.recommendedAction,
      alertSent: e.alertSent ?? false,
      externalSources: e.externalSources ?? [],
      createdAt: e.createdAt?.toISOString(),
    }));

    return NextResponse.json(serialized);
  } catch (err) {
    console.error("GET /api/risk-events:", err);
    return NextResponse.json(
      { error: "Failed to fetch risk events" },
      { status: 500 }
    );
  }
}
