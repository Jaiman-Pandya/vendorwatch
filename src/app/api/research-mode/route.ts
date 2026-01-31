import { NextRequest, NextResponse } from "next/server";
import { getResearchMode, setResearchMode, type ResearchMode } from "@/lib/config/research-mode";

const VALID: ResearchMode[] = ["basic", "deep"];

export async function GET() {
  const mode = getResearchMode();
  return NextResponse.json({ mode });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const raw = body.mode;
    if (typeof raw !== "string" || !VALID.includes(raw as ResearchMode)) {
      return NextResponse.json(
        { error: "mode must be 'basic' or 'deep'" },
        { status: 400 }
      );
    }
    setResearchMode(raw as ResearchMode);
    return NextResponse.json({ mode: getResearchMode() });
  } catch (err) {
    console.error("POST /api/research-mode:", err);
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
