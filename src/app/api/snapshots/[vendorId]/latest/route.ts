import { NextRequest, NextResponse } from "next/server";
import { getSnapshotsCollection, getVendorsCollection } from "@/lib/db/models";
import { ObjectId } from "mongodb";

/** get latest snapshot structured data for download */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ vendorId: string }> }
) {
  try {
    const { vendorId } = await params;
    if (!vendorId || !/^[a-f0-9A-F]{24}$/.test(vendorId)) {
      return NextResponse.json({ error: "Invalid vendor ID" }, { status: 400 });
    }

    const snapshotsCol = await getSnapshotsCollection();
    const vendorsCol = await getVendorsCollection();

    const vendor = await vendorsCol.findOne({ _id: new ObjectId(vendorId) });
    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    const snapshot = await snapshotsCol.findOne(
      { vendorId: new ObjectId(vendorId) },
      { sort: { createdAt: -1 } }
    );

    if (!snapshot) {
      return NextResponse.json(
        { error: "No snapshot found for this vendor" },
        { status: 404 }
      );
    }

    const payload = {
      vendor: vendor.name,
      vendorWebsite: vendor.website,
      snapshotDate: snapshot.createdAt?.toISOString(),
      contentHash: snapshot.contentHash,
      structuredData: snapshot.structuredData ?? {},
      extractionSourceUrl: snapshot.extractionSourceUrl ?? null,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/snapshots/[vendorId]/latest:", err);
    return NextResponse.json(
      { error: "Failed to fetch snapshot" },
      { status: 500 }
    );
  }
}
