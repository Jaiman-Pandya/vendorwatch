import { Resend } from "resend";
import { shouldSendAlert } from "../config/alert-preferences";

const resendClient = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "VendorWatch <onboarding@resend.dev>";
const ALERT_EMAIL = process.env.ALERT_EMAIL;

export interface AlertParams {
  vendorName: string;
  vendorWebsite: string;
  severity: "low" | "medium" | "high";
  type: string;
  summary: string;
  recommendedAction: string;
}

/**
 * Send email alert only when severity is in the selected preferences (low/medium/high).
 * Requires RESEND_API_KEY and ALERT_EMAIL in env.
 */
export async function sendRiskAlert(params: AlertParams): Promise<boolean> {
  if (!resendClient || !ALERT_EMAIL) return false;
  if (!shouldSendAlert(params.severity)) return false;

  try {
    const { error } = await resendClient.emails.send({
      from: FROM_EMAIL,
      to: [ALERT_EMAIL],
      subject: `[VendorWatch] ${params.severity.toUpperCase()} risk: ${params.vendorName}`,
      html: `
        <h2>Vendor Risk Alert</h2>
        <p><strong>Vendor:</strong> ${params.vendorName}</p>
        <p><strong>Website:</strong> <a href="${params.vendorWebsite}">${params.vendorWebsite}</a></p>
        <p><strong>Severity:</strong> ${params.severity}</p>
        <p><strong>Type:</strong> ${params.type}</p>
        <hr />
        <p><strong>Summary:</strong></p>
        <p>${params.summary}</p>
        <p><strong>Recommended action:</strong></p>
        <p>${params.recommendedAction}</p>
      `,
    });

    if (error) {
      console.error("Resend alert error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Resend alert failed:", err);
    return false;
  }
}
