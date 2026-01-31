import { NextRequest, NextResponse } from "next/server";
import { runMonitorCycle } from "@/lib/services/monitor";

/** cron endpoint for scheduled monitoring, set cron secret in env for auth */
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
