import { NextResponse } from "next/server";
import { requestCancellation } from "@/lib/services/monitor";

export async function POST() {
  try {
    requestCancellation();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("POST /api/run-monitor-cancel:", err);
    return NextResponse.json(
      { error: "Failed to cancel" },
      { status: 500 }
    );
  }
}
