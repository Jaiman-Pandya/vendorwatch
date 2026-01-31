import { NextRequest, NextResponse } from "next/server";
import {
  getVendorsCollection,
  getSnapshotsCollection,
  getRiskEventsCollection,
} from "@/lib/db/models";
import { ObjectId } from "mongodb";

/**
 * DELETE /api/vendors/[id]
 * Remove a vendor and cascade delete snapshots and risk events.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Vendor ID required" }, { status: 400 });
    }

    const vendorId = new ObjectId(id);
    const vendorsCol = await getVendorsCollection();
    const snapshotsCol = await getSnapshotsCollection();
    const riskEventsCol = await getRiskEventsCollection();

    const vendor = await vendorsCol.findOne({ _id: vendorId });
    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    await Promise.all([
      vendorsCol.deleteOne({ _id: vendorId }),
      snapshotsCol.deleteMany({ vendorId }),
      riskEventsCol.deleteMany({ vendorId }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/vendors/[id]:", err);
    return NextResponse.json(
      { error: "Failed to remove vendor" },
      { status: 500 }
    );
  }
}
