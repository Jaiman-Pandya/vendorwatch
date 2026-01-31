import { Resend } from "resend";
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { shouldSendAlert, getAlertSeverities } from "../config/alert-preferences";

const DEBUG_LOG_PATH = join(process.cwd(), ".cursor", "debug.log");

function debugLog(payload: Record<string, unknown>) {
  try {
    mkdirSync(join(process.cwd(), ".cursor"), { recursive: true });
    appendFileSync(DEBUG_LOG_PATH, JSON.stringify(payload) + "\n");
  } catch (_) {}
}

// Same as alert-test route: read env at send time so we use the same config as the working test email
function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  const from = process.env.RESEND_FROM_EMAIL ?? "VendorWatch <onboarding@resend.dev>";
  const resendClient = apiKey ? new Resend(apiKey) : null;
  return { resendClient, to, from };
}

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
  const { resendClient, to, from } = getResendConfig();
  const hasKey = !!process.env.RESEND_API_KEY;
  const hasEmail = !!process.env.ALERT_EMAIL;
  const severitiesList = getAlertSeverities();
  const willSendByPrefs = shouldSendAlert(params.severity);
  // #region agent log
  const entryPayload = {location:'alert.ts:sendRiskAlert:entry',message:'sendRiskAlert entry',data:{hasKey,hasEmail,severity:params.severity,vendorName:params.vendorName,severitiesList,willSendByPrefs},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'};
  fetch('http://127.0.0.1:7242/ingest/5f816a8f-caa0-4d2f-afb0-8fbdd38b89a4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(entryPayload)}).catch(()=>{});
  debugLog(entryPayload);
  // #endregion
  if (!resendClient || !to) {
    // #region agent log
    const earlyPayload = {location:'alert.ts:sendRiskAlert:earlyReturn',message:'early return no client or no email',data:{hasKey,hasEmail},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'};
    fetch('http://127.0.0.1:7242/ingest/5f816a8f-caa0-4d2f-afb0-8fbdd38b89a4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(earlyPayload)}).catch(()=>{});
    debugLog(earlyPayload);
    // #endregion
    return false;
  }
  if (!shouldSendAlert(params.severity)) {
    // #region agent log
    const prefsPayload = {location:'alert.ts:sendRiskAlert:earlyReturnPrefs',message:'early return severity not in prefs',data:{severity:params.severity,severitiesList},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'};
    fetch('http://127.0.0.1:7242/ingest/5f816a8f-caa0-4d2f-afb0-8fbdd38b89a4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(prefsPayload)}).catch(()=>{});
    debugLog(prefsPayload);
    // #endregion
    return false;
  }

  try {
    // #region agent log
    const beforePayload = {location:'alert.ts:sendRiskAlert:beforeSend',message:'calling Resend API',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'};
    fetch('http://127.0.0.1:7242/ingest/5f816a8f-caa0-4d2f-afb0-8fbdd38b89a4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(beforePayload)}).catch(()=>{});
    debugLog(beforePayload);
    // #endregion
    // Same call shape as alert-test route: from, to: [ALERT_EMAIL], subject, html
    const { error } = await resendClient.emails.send({
      from,
      to: [to],
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
      // #region agent log
      debugLog({ location: "alert.ts:sendRiskAlert:resendError", message: "Resend API error", data: { errorMessage: String((error as { message?: string })?.message ?? error), errorName: (error as { name?: string })?.name }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H5" });
      // #endregion
      console.error("Resend alert error:", error);
      return false;
    }
    // #region agent log
    debugLog({ location: "alert.ts:sendRiskAlert:success", message: "email sent", data: {}, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H5" });
    // #endregion
    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // #region agent log
    debugLog({ location: "alert.ts:sendRiskAlert:catch", message: "Resend throw", data: { errMsg }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H5" });
    // #endregion
    console.error("Resend alert failed:", err);
    return false;
  }
}
