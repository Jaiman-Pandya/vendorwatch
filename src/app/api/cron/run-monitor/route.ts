import { NextRequest, NextResponse } from "next/server";
import { runMonitorCycle } from "@/lib/services/monitor";

/**
 * Cron endpoint for scheduled monitoring.
 * Call: POST /api/cron/run-monitor
 *
 * Security: Set CRON_SECRET in env. If set, require one of:
 * - Authorization: Bearer <CRON_SECRET>
 * - x-cron-secret: <CRON_SECRET>
 * - ?secret=<CRON_SECRET> (for Vercel Cron)
 * If not set, anyone can trigger (local dev only).
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    const headerSecret = request.headers.get("x-cron-secret");
    const urlSecret = new URL(request.url).searchParams.get("secret");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : headerSecret ?? urlSecret;
    if (token !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const results = await runMonitorCycle();
    return NextResponse.json({
      success: true,
      message: `Processed ${results.length} vendor(s).`,
      results,
    });
  } catch (err) {
    console.error("Cron run-monitor:", err);
    return NextResponse.json(
      { error: "Monitoring cycle failed" },
      { status: 500 }
    );
  }
}
