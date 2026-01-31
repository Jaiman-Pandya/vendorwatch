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

export interface Snapshot {
  _id?: ObjectId;
  vendorId: ObjectId;
  contentHash: string;
  extractedText: string;
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
