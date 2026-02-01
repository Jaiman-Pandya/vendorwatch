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

// read env at send time, same as alert test route
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

/** send email alert when severity matches user prefs, needs resend api key and alert email */
export async function sendRiskAlert(params: AlertParams): Promise<boolean> {
  const { resendClient, to, from } = getResendConfig();
  const hasKey = !!process.env.RESEND_API_KEY;
  const hasEmail = !!process.env.ALERT_EMAIL;
  const severitiesList = getAlertSeverities();
  const willSendByPrefs = shouldSendAlert(params.severity);
  const entryPayload = {location:'alert.ts:sendRiskAlert:entry',message:'sendRiskAlert entry',data:{hasKey,hasEmail,severity:params.severity,vendorName:params.vendorName,severitiesList,willSendByPrefs},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'};
  fetch('http://127.0.0.1:7242/ingest/5f816a8f-caa0-4d2f-afb0-8fbdd38b89a4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(entryPayload)}).catch(()=>{});
  debugLog(entryPayload);
  if (!resendClient || !to) {
    const earlyPayload = {location:'alert.ts:sendRiskAlert:earlyReturn',message:'early return no client or no email',data:{hasKey,hasEmail},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'};
    fetch('http://127.0.0.1:7242/ingest/5f816a8f-caa0-4d2f-afb0-8fbdd38b89a4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(earlyPayload)}).catch(()=>{});
    debugLog(earlyPayload);
    return false;
  }
  if (!shouldSendAlert(params.severity)) {
    const prefsPayload = {location:'alert.ts:sendRiskAlert:earlyReturnPrefs',message:'early return severity not in prefs',data:{severity:params.severity,severitiesList},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'};
    fetch('http://127.0.0.1:7242/ingest/5f816a8f-caa0-4d2f-afb0-8fbdd38b89a4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(prefsPayload)}).catch(()=>{});
    debugLog(prefsPayload);
    return false;
  }

  try {
    const beforePayload = {location:'alert.ts:sendRiskAlert:beforeSend',message:'calling Resend API',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'};
    fetch('http://127.0.0.1:7242/ingest/5f816a8f-caa0-4d2f-afb0-8fbdd38b89a4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(beforePayload)}).catch(()=>{});
    debugLog(beforePayload);

    const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const nl2br = (s: string) => esc(s).replace(/\n/g, "<br />");

    const { error } = await resendClient.emails.send({
      from,
      to: [to],
      subject: `[VendorWatch] ${params.severity.toUpperCase()} risk: ${params.vendorName}`,
      html: `
        <h2>Vendor Risk Alert</h2>
        <p><strong>Vendor:</strong> ${esc(params.vendorName)}</p>
        <p><strong>Website:</strong> <a href="${esc(params.vendorWebsite)}">${esc(params.vendorWebsite)}</a></p>
        <p><strong>Severity:</strong> ${esc(params.severity)}</p>
        <p><strong>Type:</strong> ${esc(params.type)}</p>
        <hr />
        <h3>Summary</h3>
        <div style="margin: 0 0 1rem 0; line-height: 1.6; white-space: pre-wrap;">${nl2br(params.summary)}</div>
        <h3>Recommended Actions</h3>
        <div style="margin: 0; line-height: 1.6; white-space: pre-wrap;">${nl2br(params.recommendedAction)}</div>
      `,
    });

    if (error) {
      debugLog({ location: "alert.ts:sendRiskAlert:resendError", message: "Resend API error", data: { errorMessage: String((error as { message?: string })?.message ?? error), errorName: (error as { name?: string })?.name }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H5" });
      console.error("Resend alert error:", error);
      return false;
    }
    debugLog({ location: "alert.ts:sendRiskAlert:success", message: "email sent", data: {}, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H5" });
    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    debugLog({ location: "alert.ts:sendRiskAlert:catch", message: "Resend throw", data: { errMsg }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H5" });
    console.error("Resend alert failed:", err);
    return false;
  }
}
