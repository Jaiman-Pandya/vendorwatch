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

/** structured extraction from reducto, used for rule engine comparison */
export interface SnapshotStructuredData {
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

/** structured risk finding for display */
export interface RiskFindingRecord {
  category: string;
  finding: string;
}

export interface RiskEvent {
  _id?: ObjectId;
  vendorId: ObjectId;
  severity: "low" | "medium" | "high";
  type: string;
  summary: string;
  recommendedAction: string;
  /** canonical facts from reducto structured data */
  structuredInsights?: string;
  /** actionable liabilities extracted from structured data */
  riskFindings?: RiskFindingRecord[];
  /** rules for basic research, ai for deep research */
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
