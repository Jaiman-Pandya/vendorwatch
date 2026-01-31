import { ObjectId } from "mongodb";
import { getDb } from "./mongo";

export const COLLECTIONS = {
  VENDORS: "vendors",
  SNAPSHOTS: "snapshots",
  RISK_EVENTS: "riskEvents",
} as const;

export interface Vendor {
  _id?: ObjectId;
  name: string;
  website: string;
  category?: string;
  createdAt: Date;
}

/** Structured extraction from Reducto (plan-aligned); used for rule-engine comparison. */
export interface SnapshotStructuredData {
  pricing_terms?: string;
  fee_structures?: string;
  liability_clauses?: string;
  indemnification_terms?: string;
  termination_terms?: string;
  renewal_terms?: string;
  data_retention_policies?: string;
  data_residency_locations?: string;
  encryption_practices?: string;
  compliance_references?: string;
  sla_uptime_commitments?: string;
  support_response_times?: string;
  data_export_rights?: string;
  [key: string]: string | undefined;
}

export interface Snapshot {
  _id?: ObjectId;
  vendorId: ObjectId;
  contentHash: string;
  extractedText: string;
  structuredData?: SnapshotStructuredData;
  createdAt: Date;
}

export interface ExternalSource {
  url: string;
  title?: string;
  snippet?: string;
  source: "news" | "web";
}

export interface RiskEvent {
  _id?: ObjectId;
  vendorId: ObjectId;
  severity: "low" | "medium" | "high";
  type: string;
  summary: string;
  recommendedAction: string;
  /** "rules" = Basic Research (rule engine); "ai" = Deep Research (LLM). */
  source?: "rules" | "ai";
  alertSent?: boolean;
  externalSources?: ExternalSource[];
  createdAt: Date;
}

export async function getVendorsCollection() {
  const db = await getDb();
  return db.collection<Vendor>(COLLECTIONS.VENDORS);
}

export async function getSnapshotsCollection() {
  const db = await getDb();
  return db.collection<Snapshot>(COLLECTIONS.SNAPSHOTS);
}

export async function getRiskEventsCollection() {
  const db = await getDb();
  return db.collection<RiskEvent>(COLLECTIONS.RISK_EVENTS);
}
