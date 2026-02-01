"use client";

import { useState, useEffect } from "react";
import { toCSV, toMarkdown } from "@/lib/services/exportFormats";
import { useTheme } from "@/lib/theme-provider";
import { groupFindingsByCategory, extractRiskFindings } from "@/lib/services/risk-insights";
import { structuredDataToTableRows } from "@/lib/services/structured-summary";
import { formalizeValue, formalizeValueMultiline, parseForBold } from "@/lib/utils/format-display";

interface Vendor {
  id: string;
  name: string;
  website: string;
  createdAt: string;
}

interface ExternalSource {
  url: string;
  title?: string;
  snippet?: string;
  source: "news" | "web";
}

interface RiskFinding {
  category: string;
  finding: string;
}

interface RiskEvent {
  id: string;
  vendor: string;
  vendorId: string;
  severity: "low" | "medium" | "high";
  type: string;
  summary: string;
  recommendedAction?: string;
  structuredInsights?: string | null;
  riskFindings?: RiskFinding[];
  source?: "rules" | "ai";
  alertSent?: boolean;
  externalSources?: ExternalSource[];
  createdAt: string;
}

interface MonitorResult {
  vendorId: string;
  vendorName: string;
  status: "unchanged" | "changed" | "error" | "first_snapshot";
  error?: string;
  riskEventCreated?: boolean;
  pagesCrawled?: number;
  externalSourcesFound?: number;
}

interface Snapshot {
  id: string;
  vendorId: string;
  vendorName: string;
  extractedText: string;
  contentHash: string;
  structuredData?: Record<string, unknown>;
  extractionSourceUrl?: string | null;
  createdAt: string;
}

type Tab = "overview" | "vendors" | "alerts" | "content";

interface PlanInfo {
  plan: string;
  planLabel: string;
  vendorLimit: number;
  vendorsUsed: number;
  vendorsRemaining: number;
}

const severityStyles = {
  high: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
};

/** parse summary into intro and extracted terms table rows when format matches */
function parseExtractedTerms(summary: string): { intro: string; rows: { term: string; value: string }[] } | null {
  if (!summary?.trim()) return null;
  const blocks = summary.split(/\n\n+/);
  const rows: { term: string; value: string }[] = [];
  let intro = "";
  for (const block of blocks) {
    const colonIdx = block.indexOf(": ");
    if (colonIdx > 0 && colonIdx < 80) {
      const term = block.slice(0, colonIdx).trim();
      const value = block.slice(colonIdx + 2).trim();
      if (term && value && /^[\w\s&\/.-]+$/.test(term)) {
        rows.push({ term, value });
      } else if (rows.length === 0) {
        intro = intro ? `${intro}\n\n${block}` : block;
      }
    } else if (rows.length === 0) {
      intro = intro ? `${intro}\n\n${block}` : block;
    }
  }
  if (rows.length === 0) return null;
  return { intro: intro.trim(), rows };
}

/** build table rows from risk findings, one row per category with all findings combined, formalized, bullet-separated */
function riskFindingsToTableRows(findings: { category: string; finding: string }[]): { term: string; value: string }[] {
  const byTerm = new Map<string, string[]>();
  for (const f of findings) {
    if (!byTerm.has(f.category)) byTerm.set(f.category, []);
    byTerm.get(f.category)!.push(formalizeValue(f.finding));
  }
  return Array.from(byTerm.entries()).map(([term, values]) => ({
    term,
    value: values.map((v) => `• ${v}`).join("\n\n"),
  }));
}

/** render value with bold on amounts, percentages, years; handles multiline */
function FormalizedValue({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/);
  return (
    <>
      {blocks.map((block, bi) => {
        const segments = parseForBold(block);
        if (segments.length <= 1 && !segments[0]?.bold) {
          return <span key={bi}>{block}</span>;
        }
        return (
          <span key={bi}>
            {bi > 0 && <><br /><br /></>}
            {segments.map((s, i) =>
              s.bold ? (
                <strong key={i} className="font-semibold text-slate-800 dark:text-slate-200">{s.text}</strong>
              ) : (
                <span key={i}>{s.text}</span>
              )
            )}
          </span>
        );
      })}
    </>
  );
}

const typeLabels: Record<string, string> = {
  pricing: "Pricing",
  legal: "Legal",
  security: "Security",
  sla: "SLA",
  compliance: "Compliance",
  financial: "Financial",
  operational: "Operational",
  content_change: "Content Change",
  initial_scan: "Initial Scan",
  other: "Other",
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

function getDomain(url: string): string {
  const u = normalizeUrl(url);
  if (!u) return "";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

function groupVendorsByDomain(vendors: Vendor[]): Array<{ domain: string; vendors: Vendor[] }> {
  const byDomain = new Map<string, Vendor[]>();
  const sorted = [...vendors].sort((a, b) => a.name.localeCompare(b.name));
  for (const v of sorted) {
    const domain = getDomain(v.website) || "unknown";
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(v);
  }
  return Array.from(byDomain.entries())
    .map(([domain, vs]) => ({ domain, vendors: vs }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

export default function Home() {
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<Tab>("overview");
  const [vendorName, setVendorName] = useState("");
  const [vendorWebsite, setVendorWebsite] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [riskEvents, setRiskEvents] = useState<RiskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [monitorResults, setMonitorResults] = useState<MonitorResult[] | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [planDropdownOpen, setPlanDropdownOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [monitorProgress, setMonitorProgress] = useState<{ current: number; total: number; vendorName?: string } | null>(null);
  const [alertSeverities, setAlertSeverities] = useState<("low" | "medium" | "high")[]>([]);
  const [alertEmailConfigured, setAlertEmailConfigured] = useState(false);
  const [alertEmailMasked, setAlertEmailMasked] = useState<string | null>(null);
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [researchMode, setResearchMode] = useState<"basic" | "deep">("deep");
  const [savingResearchMode, setSavingResearchMode] = useState(false);

  const fetchPlan = async () => {
    try {
      const res = await fetch("/api/plan");
      if (res.ok) setPlan(await res.json());
    } catch {
      setPlan(null);
    }
  };

  const fetchVendors = async () => {
    try {
      const res = await fetch("/api/vendors");
      if (res.ok) {
        const list = await res.json();
        setVendors(list);
        setSelectedVendorIds((prev) => {
          const ids = (list as Vendor[]).map((v) => v.id);
          if (prev.length === 0) return ids;
          const kept = prev.filter((id) => ids.includes(id));
          return ids.length > 0 && kept.length === 0 ? ids : kept.length ? kept : ids;
        });
      }
    } catch {
      setVendors([]);
      setSelectedVendorIds([]);
    }
  };

  const fetchRiskEvents = async () => {
    try {
      const res = await fetch("/api/risk-events");
      if (res.ok) setRiskEvents(await res.json());
    } catch {
      setRiskEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchSnapshots = async () => {
    try {
      const res = await fetch("/api/snapshots");
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data.snapshots ?? []);
      }
    } catch {
      setSnapshots([]);
    }
  };

  const fetchAlertPreferences = async () => {
    try {
      const res = await fetch("/api/alert-preferences");
      if (res.ok) {
        const data = await res.json();
        setAlertSeverities(data.severities ?? ["medium", "high"]);
        setAlertEmailConfigured(Boolean(data.emailConfigured));
        setAlertEmailMasked(data.emailMasked ?? null);
      }
    } catch {
      setAlertSeverities(["medium", "high"]);
      setAlertEmailConfigured(false);
    }
  };

  const fetchResearchMode = async () => {
    try {
      const res = await fetch("/api/research-mode");
      if (res.ok) {
        const data = await res.json();
        setResearchMode(data.mode ?? "deep");
      }
    } catch {
      setResearchMode("deep");
    }
  };

  useEffect(() => {
    fetchPlan();
    fetchVendors();
    fetchRiskEvents();
    fetchSnapshots();
    fetchAlertPreferences();
    fetchResearchMode();
  }, []);

  const atVendorLimit = plan ? plan.vendorsUsed >= plan.vendorLimit : false;

  const handleUpgradePlan = async (newPlan: string) => {
    setUpgrading(true);
    setPlanDropdownOpen(false);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: newPlan }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Upgrade failed");
      }
      setPlan(await res.json());
      setSuccessMessage(`Upgraded to ${newPlan.charAt(0).toUpperCase() + newPlan.slice(1)}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upgrade failed");
    } finally {
      setUpgrading(false);
    }
  };

  const clearMessages = () => {
    setError(null);
    setSuccessMessage(null);
    setMonitorResults(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    clearMessages();
    try {
      const website = normalizeUrl(vendorWebsite);
      if (!website) throw new Error("Please enter a valid website URL");
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: vendorName.trim(), website }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to add vendor");
      }
      setVendorName("");
      setVendorWebsite("");
      setSuccessMessage(`Added "${vendorName.trim()}". Run monitor to scrape.`);
      await fetchVendors();
      await fetchPlan();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add vendor");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteVendor = async (id: string, name: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/vendors/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to remove");
      }
      setSuccessMessage(`Removed ${name}`);
      setConfirmDelete(null);
      setError(null);
      await fetchVendors();
      await fetchRiskEvents();
      await fetchSnapshots();
      await fetchPlan();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove vendor");
    } finally {
      setDeletingId(null);
    }
  };

  const monitorTargetCount = selectedVendorIds.length;

  const handleRunMonitor = async () => {
    const idsToRun = selectedVendorIds.length > 0 ? [...selectedVendorIds] : [];
    if (idsToRun.length === 0) {
      setError("Select at least one site to monitor.");
      return;
    }
    setMonitoring(true);
    setMonitorProgress({ current: 0, total: idsToRun.length });
    setMonitorResults(null);
    clearMessages();

    try {
      const response = await fetch("/api/run-monitor-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorIds: idsToRun }),
      });
      if (!response.ok) throw new Error("Monitor failed");
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const allResults: MonitorResult[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          const data = JSON.parse(line.slice(6));
          
          if (data.type === "progress") {
            setMonitorProgress({
              current: data.current || 0,
              total: data.total || idsToRun.length,
              vendorName: data.vendorName,
            });
          } else if (data.type === "result") {
            if (data.result) allResults.push(data.result);
            setMonitorProgress({
              current: data.current || 0,
              total: data.total || idsToRun.length,
            });
          } else if (data.type === "complete") {
            setMonitorResults(data.results || allResults);
            setMonitorProgress({ current: data.results?.length || allResults.length, total: data.results?.length || allResults.length });
            
            const changed = (data.results || allResults).filter((r: MonitorResult) => r.status === "changed").length;
            const first = (data.results || allResults).filter((r: MonitorResult) => r.status === "first_snapshot").length;
            const errors = (data.results || allResults).filter((r: MonitorResult) => r.status === "error").length;
            
            if (changed > 0) {
              setSuccessMessage(`Analyzed ${changed} change(s). Risk alerts created.`);
            } else if (first > 0) {
              setSuccessMessage(`Scraped ${first} vendor(s). Run again later to detect changes.`);
            } else if (errors > 0) {
              setError(`${errors} vendor(s) failed.`);
            } else if ((data.results || allResults).length === 0) {
              setSuccessMessage("No vendors to monitor.");
            } else {
              setSuccessMessage("All vendors unchanged.");
            }
            
            await fetchRiskEvents();
            await fetchSnapshots();
            break;
          } else if (data.type === "error") {
            throw new Error(data.error || "Monitor failed");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Monitor failed");
    } finally {
      setMonitoring(false);
      setTimeout(() => setMonitorProgress(null), 2000);
    }
  };

  const handleCancelMonitor = async () => {
    try {
      await fetch("/api/run-monitor-cancel", { method: "POST" });
      setSuccessMessage("Monitoring cancelled. Showing partial results.");
    } catch (err) {
      console.error("Cancel failed:", err);
    }
  };

  const handleSaveAlertPreferences = async () => {
    setSavingAlerts(true);
    setError(null);
    try {
      const res = await fetch("/api/alert-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ severities: alertSeverities }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Save failed");
      }
      setSuccessMessage("Email preferences saved.");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingAlerts(false);
    }
  };

  const handleSendTestEmail = async () => {
    setSendingTest(true);
    setError(null);
    try {
      const res = await fetch("/api/alert-test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setSuccessMessage("Test email sent. Check your inbox (and spam).");
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSendingTest(false);
    }
  };

  const baseFilename = (vendorName: string) =>
    `vendorwatch-${vendorName.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}`;

  const handleDownloadVendorData = async (
    vendorId: string,
    vendorName: string,
    format: "json" | "csv" | "markdown"
  ) => {
    try {
      const res = await fetch(`/api/snapshots/${vendorId}/latest`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      let content: string;
      let mimeType: string;
      let extension: string;

      switch (format) {
        case "csv":
          content = toCSV(data);
          mimeType = "text/csv";
          extension = "csv";
          break;
        case "markdown":
          content = toMarkdown(data);
          mimeType = "text/markdown";
          extension = "md";
          break;
        default:
          content = JSON.stringify(data, null, 2);
          mimeType = "application/json";
          extension = "json";
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseFilename(vendorName)}.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccessMessage(`Downloaded ${vendorName} as ${format.toUpperCase()}`);
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const toggleAlertSeverity = (s: "low" | "medium" | "high") => {
    setAlertSeverities((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const handleSetResearchMode = async (mode: "basic" | "deep") => {
    setSavingResearchMode(true);
    setError(null);
    try {
      const res = await fetch("/api/research-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Save failed");
      }
      const data = await res.json();
      setResearchMode(data.mode ?? mode);
      setSuccessMessage(`Research mode: ${(data.mode ?? mode) === "deep" ? "Deep (AI)" : "Basic (rules)"}`);
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingResearchMode(false);
    }
  };

  const navItems: { id: Tab; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "vendors", label: "Vendors", count: vendors.length },
    { id: "alerts", label: "Risk Alerts", count: riskEvents.length },
    { id: "content", label: "Extracted Content", count: snapshots.length },
  ];


  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 transition-colors duration-200">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 text-white font-semibold shadow-lg shadow-indigo-500/20 dark:from-indigo-500 dark:to-indigo-600">
              V
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">VendorWatch</h1>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Vendor Risk Monitoring</p>
            </div>
            {plan && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPlanDropdownOpen(!planDropdownOpen)}
                  disabled={upgrading}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50"
                >
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{plan.planLabel}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {plan.vendorsUsed} / {plan.vendorLimit} sites
                  </span>
                  <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {planDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setPlanDropdownOpen(false)} aria-hidden="true" />
                    <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                      {(["basic", "premium", "enterprise"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handleUpgradePlan(p)}
                          className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-700 ${
                            plan.plan === p
                              ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300"
                              : "text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          <span>{p.charAt(0).toUpperCase() + p.slice(1)}</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {p === "basic" ? "5" : p === "premium" ? "15" : "500"} sites
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {theme === "light" ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => { fetchPlan(); fetchVendors(); fetchRiskEvents(); fetchSnapshots(); setSuccessMessage("Refreshed"); setTimeout(() => setSuccessMessage(null), 2000); }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Refresh
            </button>
            {monitoring ? (
            <button
              type="button"
              onClick={handleCancelMonitor}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
            >
                Stop
              </button>
            ) : (
            <button
              type="button"
              onClick={handleRunMonitor}
              disabled={vendors.length === 0 || monitorTargetCount === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-700 hover:shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none dark:bg-indigo-500 dark:shadow-indigo-500/20 dark:hover:bg-indigo-600"
            >
              Run Monitor {monitorTargetCount > 0 ? ` (${monitorTargetCount})` : ""}
            </button>
            )}
          </div>
        </div>
        {/* Tabs */}
        <nav className="mx-auto max-w-7xl px-6">
          <div className="flex gap-1 border-b border-slate-200/80 dark:border-slate-800">
            {navItems.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`border-b-2 px-5 py-3.5 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900 ${
                  tab === t.id
                    ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                    : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50/50 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50"
                }`}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-xs dark:bg-slate-700">
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Progress bar */}
        {monitorProgress && (
          <div className="mb-6 rounded-xl border border-indigo-200/80 bg-indigo-50/80 p-5 shadow-sm dark:border-indigo-800/50 dark:bg-indigo-900/20">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-indigo-900 dark:text-indigo-100">
                Monitoring vendors... {monitorProgress.current} / {monitorProgress.total}
              </span>
              <span className="text-indigo-700 dark:text-indigo-300">
                {Math.round((monitorProgress.current / monitorProgress.total) * 100)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-200 dark:bg-indigo-800">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-300 dark:bg-indigo-400"
                style={{ width: `${(monitorProgress.current / monitorProgress.total) * 100}%` }}
              />
            </div>
            {monitorProgress.vendorName && (
              <p className="mt-2 text-xs text-indigo-600 dark:text-indigo-400">
                Processing: {monitorProgress.vendorName}
              </p>
            )}
            <p className="mt-2 text-xs text-indigo-600 dark:text-indigo-400">
              Main scrape + web search (~30s/vendor). First-time: +3-page crawl (~90s extra)
            </p>
          </div>
        )}

        {/* Messages */}
        {error && (
          <div className="mb-6 rounded-xl border border-red-200/80 bg-red-50 p-4 text-sm font-medium text-red-800 shadow-sm dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="mb-6 rounded-xl border border-emerald-200/80 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300">
            {successMessage}
          </div>
        )}

        {/* Overview */}
        {tab === "overview" && (
          <div className="space-y-8 transition-opacity duration-300">
            <section>
              <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-white">Summary</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Vendors Monitored</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{vendors.length}</p>
                </div>
                <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Risk Alerts</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{riskEvents.length}</p>
                </div>
                <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Snapshots Stored</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{snapshots.length}</p>
                </div>
              </div>
            </section>

            {vendors.length > 0 && (
              <section>
                <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-white">Sites to Monitor</h2>
                <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
                    Select which vendors to include when you run the monitor. Only selected sites are processed.
                  </p>
                  <div className="mb-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedVendorIds(vendors.map((v) => v.id))}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedVendorIds([])}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Deselect All
                    </button>
                    <span className="flex items-center py-1.5 text-sm text-slate-500 dark:text-slate-400">
                      {selectedVendorIds.length} of {vendors.length} selected
                    </span>
                  </div>
                  <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                    {vendors.map((v) => (
                      <li key={v.id} className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id={`monitor-${v.id}`}
                          checked={selectedVendorIds.includes(v.id)}
                          onChange={() => {
                            setSelectedVendorIds((prev) =>
                              prev.includes(v.id) ? prev.filter((id) => id !== v.id) : [...prev, v.id]
                            );
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
                        />
                        <label htmlFor={`monitor-${v.id}`} className="flex-1 cursor-pointer text-sm text-slate-700 dark:text-slate-300">
                          <span className="font-medium">{v.name}</span>
                          <span className="ml-2 text-slate-500 dark:text-slate-400">{v.website}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            <section>
                <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-white">Research Mode</h2>
              <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                  Basic: rule-based detection from structured data only. Deep: adds AI insights for richer summaries and recommendations.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleSetResearchMode("basic")}
                    disabled={savingResearchMode}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
                      researchMode === "basic"
                        ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    Basic (rules)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetResearchMode("deep")}
                    disabled={savingResearchMode}
                    className={`rounded-lg border px-4 py-2 text-sm font-medium transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
                      researchMode === "deep"
                        ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    Deep (AI)
                  </button>
                </div>
              </div>
            </section>

            <section>
              <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-white">Pipeline</h2>
              <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-medium dark:bg-slate-800">Firecrawl</span>
                  <span className="text-slate-400">+</span>
                  <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-medium dark:bg-slate-800">Crawl</span>
                  <span className="text-slate-400">+</span>
                  <span className="rounded-lg bg-indigo-100 px-3 py-1.5 font-medium text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">Web Search</span>
                  <span className="text-slate-400">→</span>
                  <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-medium dark:bg-slate-800">Hash</span>
                  <span className="text-slate-400">→</span>
                  <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-medium dark:bg-slate-800">Reducto</span>
                  <span className="text-slate-400">→</span>
                  <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-medium dark:bg-slate-800">{researchMode === "deep" ? "Rules + Insights" : "Rules"}</span>
                  <span className="text-slate-400">→</span>
                  <span className="rounded-lg bg-slate-100 px-3 py-1.5 font-medium dark:bg-slate-800">Resend</span>
                </div>
              </div>
            </section>

            <section>
                <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-white">Email Alerts</h2>
              <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                    Select which severities trigger an email. You can enable any combination of Low, Medium, or High.
                  </p>
                <div className="mb-4 flex flex-wrap gap-4">
                  {(["low", "medium", "high"] as const).map((s) => (
                    <label key={s} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={alertSeverities.includes(s)}
                        onChange={() => toggleAlertSeverity(s)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
                      />
                      <span className={`text-sm font-medium capitalize rounded px-2 py-0.5 ${severityStyles[s]}`}>
                        {s}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mb-4 text-sm text-slate-500 dark:text-slate-400">
                  {alertEmailConfigured ? (
                    <>Emails are sent to: <strong>{alertEmailMasked ?? "—"}</strong></>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">
                      Set RESEND_API_KEY and ALERT_EMAIL in .env.local to receive emails.
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleSaveAlertPreferences}
                    disabled={savingAlerts}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                  >
                    {savingAlerts ? "Saving…" : "Save Preferences"}
                  </button>
                  {alertEmailConfigured && (
                    <button
                      type="button"
                      onClick={handleSendTestEmail}
                      disabled={sendingTest}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                    >
                      {sendingTest ? "Sending…" : "Send Test Email"}
                    </button>
                  )}
                </div>
              </div>
            </section>

            {monitorResults && monitorResults.length > 0 && (
              <section>
                <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-white">Last Monitor Run</h2>
                <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="px-4 py-3 text-left font-medium text-slate-700 dark:text-slate-300">Vendor</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-700 dark:text-slate-300">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monitorResults.map((r) => (
                        <tr key={r.vendorId} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{r.vendorName}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-400">
                              {r.status === "first_snapshot" && <span>First scrape</span>}
                              {r.status === "unchanged" && <span>No changes</span>}
                              {r.status === "changed" && <span>Change detected → alert</span>}
                              {r.status === "error" && <span className="text-red-600 dark:text-red-400">Error: {r.error ?? "Unknown"}</span>}
                              {r.status !== "error" && r.pagesCrawled != null && r.pagesCrawled > 0 && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-700">{r.pagesCrawled} pages crawled</span>
                              )}
                              {r.status !== "error" && r.externalSourcesFound != null && r.externalSourcesFound > 0 && (
                                <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">{r.externalSourcesFound} external sources</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}

        {/* Vendors */}
        {tab === "vendors" && (
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-white">Add Vendor</h2>
              {atVendorLimit && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                  <p className="mb-3 text-sm font-medium text-amber-800 dark:text-amber-200">
                    Vendor limit reached ({plan?.vendorLimit} sites on {plan?.planLabel}).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(["premium", "enterprise"] as const)
                      .filter((p) => p !== plan?.plan)
                      .map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handleUpgradePlan(p)}
                          disabled={upgrading}
                          className="rounded-lg bg-amber-200 px-3 py-1.5 text-sm font-medium text-amber-900 transition hover:bg-amber-300 disabled:opacity-50 dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700"
                        >
                          Upgrade to {p.charAt(0).toUpperCase() + p.slice(1)} ({p === "premium" ? "15" : "500"} sites)
                        </button>
                      ))}
                  </div>
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                  <input
                    type="text"
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    placeholder="e.g. Stripe"
                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Website</label>
                  <input
                    type="text"
                    value={vendorWebsite}
                    onChange={(e) => setVendorWebsite(e.target.value)}
                    placeholder="https://stripe.com"
                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting || atVendorLimit}
                  className="w-full rounded-lg bg-indigo-600 py-2.5 font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Adding…" : atVendorLimit ? "Limit reached" : "Add Vendor"}
                </button>
              </form>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-white">Monitored Vendors</h2>
              <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
                Vendors are grouped by domain. Duplicate websites are not allowed.
              </p>
              {vendors.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center dark:border-slate-700">
                <p className="font-medium text-slate-600 dark:text-slate-400">No vendors yet</p>
                <p className="mt-1 text-sm text-slate-400">Add a vendor above to get started.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {groupVendorsByDomain(vendors).map(({ domain, vendors: groupVendors }) => (
                    <div key={domain}>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{domain}</span>
                        {groupVendors.length > 1 && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            {groupVendors.length} entries
                          </span>
                        )}
                      </div>
                      <ul className="space-y-2">
                        {groupVendors.map((v) => (
                          <li
                            key={v.id}
                            className="group flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-3 transition hover:border-slate-200 dark:border-slate-800 dark:hover:border-slate-700"
                          >
                            {confirmDelete === v.id ? (
                              <>
                                <span className="text-sm text-slate-600 dark:text-slate-400">Remove {v.name}?</span>
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDelete(null)}
                                    className="rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteVendor(v.id, v.name)}
                                    disabled={deletingId === v.id}
                                    className="rounded bg-red-600 px-2 py-1 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                                  >
                                    {deletingId === v.id ? "Removing…" : "Remove"}
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="min-w-0 flex-1">
                                  <span className="font-medium text-slate-900 dark:text-white">{v.name}</span>
                                  <a
                                    href={normalizeUrl(v.website)}
            target="_blank"
            rel="noopener noreferrer"
                                    className="ml-2 text-sm text-indigo-600 hover:underline dark:text-indigo-400"
                                  >
                                    {v.website}
                                  </a>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDelete(v.id)}
                                  className="shrink-0 rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800 dark:hover:text-red-400"
                                  title="Remove vendor"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Risk Alerts */}
        {tab === "alerts" && (
          <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="border-b border-slate-200/80 px-6 py-5 dark:border-slate-700">
              <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">Risk Alerts</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Structured risk findings from vendor terms, privacy policies, and SLAs. Each alert summarizes liabilities, indemnification, data residency, compliance, and pricing terms. Findings are grouped by Legal, Data & Security, Financial, and Operational risk for review.
              </p>
            </div>
            {loading ? (
              <div className="p-8 text-center text-slate-500">Loading…</div>
            ) : riskEvents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-16 text-center dark:border-slate-700">
                <p className="font-medium text-slate-600 dark:text-slate-400">No alerts yet</p>
                <p className="mt-1 text-sm text-slate-400">Add vendors and run the monitor to surface liabilities and risk findings.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {riskEvents.map((event) => {
                  const grouped = groupFindingsByCategory(
                    (event.riskFindings ?? []).map((f) => ({ category: f.category, finding: f.finding }))
                  );
                  return (
                    <li key={event.id} className="p-6 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900 dark:text-white">{event.vendor}</span>
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${severityStyles[event.severity]}`}>
                              {event.severity}
                            </span>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                              {typeLabels[event.type] ?? event.type}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                event.source === "rules"
                                  ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                                  : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                              }`}
                              title={event.source === "rules" ? "Rule-based detection" : "Insights"}
                            >
                              {event.source === "rules" ? "Rules" : "Insights"}
                            </span>
                            {event.alertSent && (
                              <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                Email Sent
                              </span>
                            )}
                          </div>
                          {(grouped.length > 0 || (event.externalSources && event.externalSources.length > 0)) && (
                            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                              <span>Findings:</span>
                              {grouped.length > 0 && <span>Reducto (Terms/Policy)</span>}
                              {grouped.length > 0 && event.externalSources && event.externalSources.length > 0 && <span>·</span>}
                              {event.externalSources && event.externalSources.length > 0 && <span>News & Web</span>}
                            </div>
                          )}
                          {grouped.length > 0 ? (
                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                              {grouped.map(({ category, findings }) => (
                                <div key={category} className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">{category}</p>
                                  <ul className="space-y-1.5">
                                    {findings.map((finding, i) => (
                                      <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500 dark:bg-indigo-400" aria-hidden="true" />
                                        <span><FormalizedValue text={formalizeValue(finding)} /></span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {event.summary && (
                            <div className="mt-4">
                              {(() => {
                                const findingsRows = event.riskFindings?.length
                                  ? riskFindingsToTableRows(event.riskFindings)
                                  : [];
                                const parsed = parseExtractedTerms(event.summary);
                                const parsedRows = parsed?.rows?.map((r) => ({
                                  term: formalizeValue(r.term),
                                  value: formalizeValueMultiline(r.value),
                                })) ?? [];
                                const rows = findingsRows.length > 0
                                  ? findingsRows
                                  : parsedRows;
                                if (rows.length > 0) {
                                  return (
                                    <>
                                      {parsed?.intro && findingsRows.length === 0 && (
                                        <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">{parsed.intro}</p>
                                      )}
                                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/50">
                                        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                                          <thead>
                                            <tr>
                                              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Term</th>
                                              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Value</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                            {rows.map((row, i) => (
                                              <tr key={i} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                                                <td className="px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-200">{row.term}</td>
                                                <td className="whitespace-pre-wrap px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
                                                  <FormalizedValue text={row.value} />
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </>
                                  );
                                }
                                return <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{event.summary}</p>;
                              })()}
                            </div>
                          )}
                          {event.recommendedAction && (
                            <div className="mt-4 rounded-lg border-l-4 border-indigo-500 bg-indigo-50/50 py-3 pl-4 pr-3 dark:bg-indigo-900/20 dark:border-indigo-400">
                              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">Recommended Actions</p>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">{event.recommendedAction}</p>
                            </div>
                          )}
                          {event.externalSources && event.externalSources.length > 0 && (
                            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">External Sources</p>
                              <ul className="space-y-3">
                                {event.externalSources.map((src, i) => (
                                  <li key={i} className="flex gap-3">
                                    <span className="shrink-0 rounded bg-slate-200/80 px-2 py-0.5 text-xs font-medium capitalize text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                                      {src.source}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <a
                                        href={src.url}
            target="_blank"
            rel="noopener noreferrer"
                                        className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400 break-all"
                                      >
                                        {src.title || src.url}
                                      </a>
                                      {src.snippet && (
                                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{src.snippet}</p>
                                      )}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                        <span className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400">{formatTimestamp(event.createdAt)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Extracted Content */}
        {tab === "content" && (
          <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="border-b border-slate-200/80 px-6 py-5 dark:border-slate-700">
              <h2 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">Extracted Content</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Crawled content and structured extraction from vendor sites. Structured terms are only available when the vendor links to terms, privacy, or policy pages.
              </p>
            </div>
            {snapshots.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-16 text-center dark:border-slate-700">
                <p className="font-medium text-slate-600 dark:text-slate-400">No extracted content yet</p>
                <p className="mt-1 text-sm text-slate-400">Run the monitor to scrape vendor sites and extract structured data.</p>
              </div>
            ) : (
              <div className="p-6">
                <div className="mb-4 flex flex-wrap gap-2">
                  {snapshots.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSnapshot(selectedSnapshot?.id === s.id ? null : s)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        selectedSnapshot?.id === s.id
                          ? "bg-indigo-600 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      }`}
                    >
                      {s.vendorName}
                    </button>
                  ))}
                </div>
                {selectedSnapshot && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {selectedSnapshot.vendorName} — {formatTimestamp(selectedSnapshot.createdAt)}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Download</span>
                        <button
                          type="button"
                          onClick={() => handleDownloadVendorData(selectedSnapshot.vendorId, selectedSnapshot.vendorName, "json")}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          JSON
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadVendorData(selectedSnapshot.vendorId, selectedSnapshot.vendorName, "csv")}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadVendorData(selectedSnapshot.vendorId, selectedSnapshot.vendorName, "markdown")}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          Markdown
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedSnapshot(null)}
                          className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                    {selectedSnapshot.extractionSourceUrl && (
                      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                        Source: <a href={selectedSnapshot.extractionSourceUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400 break-all">{selectedSnapshot.extractionSourceUrl}</a>
                      </p>
                    )}
                    {!(selectedSnapshot.structuredData && Object.keys(selectedSnapshot.structuredData).length > 0) && (
                      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Structured parsing unavailable</p>
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                          No terms, privacy, or policy links were found on the vendor site. Raw crawled content only; structured extraction was skipped to avoid inaccurate results.
                        </p>
                      </div>
                    )}
                    {selectedSnapshot.structuredData && Object.keys(selectedSnapshot.structuredData).length > 0 && (
                      <>
                        {(() => {
                          const findings = extractRiskFindings(selectedSnapshot.structuredData);
                          const grouped = groupFindingsByCategory(findings.map((f) => ({ category: f.category, finding: f.finding })));
                          return grouped.length > 0 ? (
                            <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-800 dark:bg-indigo-900/20">
                              <p className="mb-3 text-sm font-semibold text-indigo-900 dark:text-indigo-100">Insights</p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                {grouped.map(({ category, findings: catFindings }) => (
                                  <div key={category} className="rounded border border-indigo-200/80 bg-white p-3 dark:border-indigo-800 dark:bg-slate-900/50">
                                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">{category}</p>
                                    <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
                                      {catFindings.map((f, i) => (
                                        <li key={i} className="flex gap-2">
                                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-hidden="true" />
                                          <span><FormalizedValue text={formalizeValue(f)} /></span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null;
                        })()}
                        <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/50">
                          <p className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                            Extracted Terms
                          </p>
                          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                            <thead>
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Term</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Value</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                            {structuredDataToTableRows(selectedSnapshot.structuredData).map((row, i) => (
                              <tr key={i} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                                <td className="px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-200">{row.term}</td>
                                <td className="whitespace-pre-wrap px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
                                  <FormalizedValue text={row.value} />
                                </td>
                              </tr>
                            ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-white p-4 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200">
                      {selectedSnapshot.extractedText || "(empty)"}
                    </pre>
                    <p className="mt-2 text-xs text-slate-500">{selectedSnapshot.extractedText.length} chars</p>
                  </div>
                )}
              </div>
            )}
        </div>
        )}
      </main>
    </div>
  );
}
