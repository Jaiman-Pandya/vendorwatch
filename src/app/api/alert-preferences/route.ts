import { NextRequest, NextResponse } from "next/server";
import { getAlertSeverities, setAlertSeverities, type AlertSeverity } from "@/lib/config/alert-preferences";

const VALID: AlertSeverity[] = ["low", "medium", "high"];

function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "not set";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const show = Math.min(2, Math.floor(local.length / 2));
  return `${local.slice(0, show)}***@${domain}`;
}

export async function GET() {
  const severities = getAlertSeverities();
  const email = process.env.ALERT_EMAIL;
  return NextResponse.json({
    severities,
    emailConfigured: Boolean(process.env.RESEND_API_KEY && email),
    emailMasked: email ? maskEmail(email) : undefined,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const raw = body.severities;
    if (!Array.isArray(raw)) {
      return NextResponse.json(
        { error: "severities must be an array" },
        { status: 400 }
      );
    }
    const severities = raw
      .filter((s: unknown) => typeof s === "string" && VALID.includes(s as AlertSeverity))
      .map((s: string) => s as AlertSeverity);
    setAlertSeverities(severities.length ? severities : null);
    return NextResponse.json({
      severities: getAlertSeverities(),
      emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL),
      emailMasked: process.env.ALERT_EMAIL ? maskEmail(process.env.ALERT_EMAIL) : undefined,
    });
  } catch (err) {
    console.error("POST /api/alert-preferences:", err);
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
