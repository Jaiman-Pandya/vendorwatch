import { NextResponse } from "next/server";
import { Resend } from "resend";

const resendClient = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "VendorWatch <onboarding@resend.dev>";
const ALERT_EMAIL = process.env.ALERT_EMAIL;

/**
 * POST /api/alert-test — send one test email to ALERT_EMAIL so the user can verify Resend.
 */
export async function POST() {
  if (!resendClient || !ALERT_EMAIL) {
    return NextResponse.json(
      {
        error: "Email not configured. Set RESEND_API_KEY and ALERT_EMAIL in .env.local.",
      },
      { status: 400 }
    );
  }

  try {
    const { error } = await resendClient.emails.send({
      from: FROM_EMAIL,
      to: [ALERT_EMAIL],
      subject: "[VendorWatch] Test email – alerts are working",
      html: `
        <h2>VendorWatch test email</h2>
        <p>If you received this, Resend is configured correctly and risk alerts will be sent to this address for the severities you selected (low / medium / high).</p>
        <p><strong>Tip:</strong> With Resend's free test domain (<code>onboarding@resend.dev</code>), you can only send to the email address of your Resend account. Use a verified domain in production to send to any address.</p>
      `,
    });

    if (error) {
      console.error("Resend test error:", error);
      return NextResponse.json(
        { error: error.message ?? "Resend returned an error" },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Resend test failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
