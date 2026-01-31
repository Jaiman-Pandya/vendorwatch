import { NextRequest, NextResponse } from "next/server";
import { getSnapshotsCollection, getVendorsCollection } from "@/lib/db/models";
import { ObjectId } from "mongodb";

/** get latest snapshot per vendor or for one vendor */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const vendorId = searchParams.get("vendorId");

    const snapshotsCol = await getSnapshotsCollection();
    const vendorsCol = await getVendorsCollection();

    if (vendorId) {
      const snapshot = await snapshotsCol.findOne(
        { vendorId: new ObjectId(vendorId) },
        { sort: { createdAt: -1 } }
      );
      if (!snapshot) {
        return NextResponse.json({ snapshot: null });
      }
      const vendor = await vendorsCol.findOne({ _id: snapshot.vendorId });
      return NextResponse.json({
        snapshot: {
          id: snapshot._id?.toString(),
          vendorId: snapshot.vendorId.toString(),
          vendorName: vendor?.name ?? "Unknown",
          extractedText: snapshot.extractedText,
          contentHash: snapshot.contentHash,
          structuredData: snapshot.structuredData ?? {},
          createdAt: snapshot.createdAt?.toISOString(),
        },
      });
    }

    // latest snapshot per vendor
    const allVendors = await vendorsCol.find({}).toArray();
    const snapshots: Array<{
      id: string;
      vendorId: string;
      vendorName: string;
      extractedText: string;
      contentHash: string;
      structuredData?: Record<string, unknown>;
      createdAt: string;
    }> = [];

    for (const vendor of allVendors) {
      const snapshot = await snapshotsCol.findOne(
        { vendorId: vendor._id },
        { sort: { createdAt: -1 } }
      );
      if (snapshot) {
        snapshots.push({
          id: snapshot._id!.toString(),
          vendorId: snapshot.vendorId.toString(),
          vendorName: vendor.name,
          extractedText: snapshot.extractedText,
          contentHash: snapshot.contentHash,
          structuredData: snapshot.structuredData,
          createdAt: snapshot.createdAt!.toISOString(),
        });
      }
    }

    return NextResponse.json({ snapshots });
  } catch (err) {
    console.error("GET /api/snapshots:", err);
    return NextResponse.json(
      { error: "Failed to fetch snapshots" },
      { status: 500 }
    );
  }
}
