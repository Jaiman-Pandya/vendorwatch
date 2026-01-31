import { NextRequest, NextResponse } from "next/server";
import { getVendorsCollection } from "@/lib/db/models";
import { getWebsiteKey } from "@/lib/utils/url";
import { getCurrentPlan, getVendorLimit, PLAN_LABELS } from "@/lib/config/plans";

export async function GET() {
  try {
    const vendorsCol = await getVendorsCollection();
    const vendors = await vendorsCol
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const serialized = vendors.map((v) => ({
      id: v._id?.toString(),
      name: v.name,
      website: v.website,
      category: v.category,
      createdAt: v.createdAt?.toISOString(),
    }));

    return NextResponse.json(serialized);
  } catch (err) {
    console.error("GET /api/vendors:", err);
    return NextResponse.json(
      { error: "Failed to fetch vendors" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, website, category } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "Vendor name is required" },
        { status: 400 }
      );
    }
    if (!website || typeof website !== "string" || !website.trim()) {
      return NextResponse.json(
        { error: "Vendor website is required" },
        { status: 400 }
      );
    }

    const websiteTrimmed = website.trim();
    const websiteKey = getWebsiteKey(websiteTrimmed);

    const vendorsCol = await getVendorsCollection();
    const allVendors = await vendorsCol.find({}).toArray();
    const limit = getVendorLimit();
    if (allVendors.length >= limit) {
      const plan = getCurrentPlan();
      return NextResponse.json(
        {
          error: `Vendor limit reached (${limit} sites on ${PLAN_LABELS[plan as keyof typeof PLAN_LABELS] ?? plan} plan). Upgrade to add more.`,
          limit,
          used: allVendors.length,
        },
        { status: 403 }
      );
    }
    const duplicate = allVendors.find((v) => getWebsiteKey(v.website) === websiteKey);
    if (duplicate) {
      return NextResponse.json(
        { error: `This website is already monitored as "${duplicate.name}". Remove the duplicate or use a different URL.` },
        { status: 409 }
      );
    }

    const result = await vendorsCol.insertOne({
      name: name.trim(),
      website: websiteTrimmed,
      category: category?.trim() ?? undefined,
      createdAt: new Date(),
    });

    return NextResponse.json({
      id: result.insertedId.toString(),
      name: name.trim(),
      website: websiteTrimmed,
      category: category?.trim() ?? undefined,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("POST /api/vendors:", err);
    const errMsg = err instanceof Error ? err.message : "";
    const message =
      errMsg.includes("bad auth") || errMsg.includes("authentication failed")
        ? "Database connection failed. Check MONGODB_URI in .env.local — replace <db_password> with your MongoDB Atlas password."
        : errMsg || "Failed to add vendor";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
