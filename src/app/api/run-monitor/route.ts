import { NextResponse } from "next/server";
import { runMonitorCycle } from "@/lib/services/monitor";

/**
 * POST /api/run-monitor
 * Triggers one full monitoring cycle.
 * Useful for demos and testing without waiting for cron.
 */
export async function POST() {
  try {
    const results = await runMonitorCycle();
    return NextResponse.json({
      success: true,
      message: `Monitoring complete. Processed ${results.length} vendor(s).`,
      results,
    });
  } catch (err) {
    console.error("POST /api/run-monitor:", err);
    const message = err instanceof Error ? err.message : "Failed to run monitoring cycle";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
