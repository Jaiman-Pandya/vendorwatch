/** structured schema for reducto output, fields can be string or string[] */
export interface VendorStructuredData {
  pricing_terms?: string | string[];
  fee_structures?: string | string[];
  liability_clauses?: string | string[];
  indemnification_terms?: string | string[];
  termination_terms?: string | string[];
  renewal_terms?: string | string[];
  data_retention_policies?: string | string[];
  data_residency_locations?: string | string[];
  encryption_practices?: string | string[];
  compliance_references?: string | string[];
  sla_uptime_commitments?: string | string[];
  support_response_times?: string | string[];
  data_export_rights?: string | string[];
  [key: string]: string | string[] | undefined;
}

function toStr(val: string | string[] | undefined): string {
  if (val == null) return "";
  if (Array.isArray(val)) return val.filter(Boolean).join(" ").trim().toLowerCase();
  return String(val).trim().toLowerCase();
}

export interface RuleRiskResult {
  type: "financial" | "legal" | "security" | "operational";
  severity: "low" | "medium" | "high";
  summary: string;
  recommendedAction: string;
}

function changed(
  oldVal: string | string[] | undefined,
  newVal: string | string[] | undefined
): boolean {
  return toStr(oldVal) !== toStr(newVal);
}

function isEmpty(val: string | string[] | undefined): boolean {
  return toStr(val) === "";
}

/** rule based risk detection from structured data comparison */
export function runRuleEngine(
  oldData: VendorStructuredData | null | undefined,
  newData: VendorStructuredData | null | undefined
): RuleRiskResult[] {
  const results: RuleRiskResult[] = [];
  const old_ = oldData ?? {};
  const new_ = newData ?? {};

  // financial, pricing or fees changed
  if (changed(old_.pricing_terms, new_.pricing_terms) || changed(old_.fee_structures, new_.fee_structures)) {
    results.push({
      type: "financial",
      severity: "medium",
      summary: "Pricing terms or fee structures have changed. Review the updated terms for cost or payment impact.",
      recommendedAction: "1) Compare old and new pricing/fee sections. 2) Update internal cost models if needed. 3) Notify procurement or finance if material.",
    });
  }

  // legal, liability or termination or indemnification changed
  if (changed(old_.liability_clauses, new_.liability_clauses)) {
    results.push({
      type: "legal",
      severity: "medium",
      summary: "Liability or limitation-of-liability language has changed. May affect risk allocation.",
      recommendedAction: "1) Review the new liability clauses. 2) Compare to previous terms. 3) Escalate to legal if cap decreased or scope narrowed.",
    });
  }
  if (changed(old_.termination_terms, new_.termination_terms)) {
    results.push({
      type: "legal",
      severity: "medium",
      summary: "Termination or notice period terms have changed. May affect exit or renewal timing.",
      recommendedAction: "1) Check new notice periods and termination conditions. 2) Update runbooks if notice period increased. 3) Document for contract reviews.",
    });
  }
  if (changed(old_.indemnification_terms, new_.indemnification_terms)) {
    results.push({
      type: "legal",
      severity: "medium",
      summary: "Indemnification language has changed. May affect who bears risk for claims.",
      recommendedAction: "1) Review new indemnification terms. 2) Compare to previous. 3) Involve legal if scope or carve-outs changed.",
    });
  }

  // security, data residency or compliance or retention
  if (changed(old_.data_residency_locations, new_.data_residency_locations)) {
    results.push({
      type: "security",
      severity: "high",
      summary: "Data residency or data location commitments have changed. May impact compliance (e.g. GDPR, locality).",
      recommendedAction: "1) Confirm where data will be processed/stored. 2) Check compliance impact. 3) Update DPA or risk register if needed.",
    });
  }
  if (changed(old_.compliance_references, new_.compliance_references)) {
    const removed = isEmpty(new_.compliance_references) && !isEmpty(old_.compliance_references);
    results.push({
      type: "security",
      severity: removed ? "high" : "medium",
      summary: removed
        ? "Compliance references have been removed. Verify vendor still meets required certifications."
        : "Compliance or certification references have changed. Verify continued alignment.",
      recommendedAction: "1) List current compliance claims. 2) Re-verify certifications if critical. 3) Update vendor risk assessment.",
    });
  }
  if (changed(old_.data_retention_policies, new_.data_retention_policies)) {
    results.push({
      type: "security",
      severity: "medium",
      summary: "Data retention policy has changed. May affect deletion obligations or audit requirements.",
      recommendedAction: "1) Review new retention periods and deletion process. 2) Align with internal retention policy. 3) Update DPIA if needed.",
    });
  }

  // operational, sla or support
  if (changed(old_.sla_uptime_commitments, new_.sla_uptime_commitments)) {
    results.push({
      type: "operational",
      severity: "medium",
      summary: "SLA or uptime commitments have changed. May affect availability guarantees.",
      recommendedAction: "1) Compare old and new SLA numbers. 2) If weakened, assess impact and escalation. 3) Document in vendor file.",
    });
  }
  if (changed(old_.support_response_times, new_.support_response_times)) {
    results.push({
      type: "operational",
      severity: "low",
      summary: "Support or response-time commitments have changed.",
      recommendedAction: "1) Review new support terms. 2) Update escalation playbooks if needed.",
    });
  }

  return results;
}

/** convert first rule result to risk event, or return fallback */
export function ruleResultToRiskEvent(
  ruleResults: RuleRiskResult[],
  fallbackSummary: string,
  fallbackAction: string
): RuleRiskResult {
  if (ruleResults.length > 0) {
    const first = ruleResults[0];
    return first;
  }
  return {
    type: "operational",
    severity: "low",
    summary: fallbackSummary,
    recommendedAction: fallbackAction,
  };
}
