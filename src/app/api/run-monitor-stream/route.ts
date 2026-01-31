import { NextRequest, NextResponse } from "next/server";
import { runMonitorCycle } from "@/lib/services/monitor";
import type { MonitorProgress } from "@/lib/services/monitor";

export async function POST(request: NextRequest) {
  let vendorIds: string[] | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    if (Array.isArray(body.vendorIds) && body.vendorIds.length > 0) {
      vendorIds = body.vendorIds.filter((id: unknown) => typeof id === "string");
    }
  } catch {
    // no body or invalid JSON: monitor all
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await runMonitorCycle(
          (progress: MonitorProgress) => {
            const data = `data: ${JSON.stringify(progress)}\n\n`;
            controller.enqueue(encoder.encode(data));
          },
          vendorIds
        );
        controller.close();
      } catch (err) {
        const error: MonitorProgress = {
          type: "error",
          error: err instanceof Error ? err.message : "Monitor failed",
        };
        const data = `data: ${JSON.stringify(error)}\n\n`;
        controller.enqueue(encoder.encode(data));
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
