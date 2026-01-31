"use client";

import { useState } from "react";

const MOCK_RISK_ALERTS = [
  {
    id: "1",
    vendor: "Acme Corp",
    severity: "high",
    message: "Security breach reported in supply chain",
    timestamp: "2 hours ago",
  },
  {
    id: "2",
    vendor: "TechSupply Inc",
    severity: "medium",
    message: "Financial instability indicators detected",
    timestamp: "5 hours ago",
  },
  {
    id: "3",
    vendor: "Global Logistics",
    severity: "low",
    message: "Compliance documentation overdue",
    timestamp: "1 day ago",
  },
  {
    id: "4",
    vendor: "DataVault Services",
    severity: "high",
    message: "Data privacy audit failed",
    timestamp: "2 days ago",
  },
];

const severityStyles = {
  high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export default function Home() {
  const [vendorName, setVendorName] = useState("");
  const [vendorWebsite, setVendorWebsite] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Mock: would call API in real implementation
    console.log("Add vendor:", { vendorName, vendorWebsite });
    setVendorName("");
    setVendorWebsite("");
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <main className="mx-auto max-w-6xl px-6 py-12">
        {/* Header */}
        <header className="mb-12">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-5xl">
            VendorWatch
          </h1>
          <p className="mt-3 text-lg text-slate-600 dark:text-slate-400">
            Monitor vendor risk in real time. Track security, financial, and
            compliance signals across your supply chain.
          </p>
        </header>

        {/* Cards grid */}
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Add Vendor Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 text-xl font-semibold text-slate-900 dark:text-white">
              Add Vendor
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="vendor-name"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Vendor Name
                </label>
                <input
                  id="vendor-name"
                  type="text"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="vendor-website"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Website
                </label>
                <input
                  id="vendor-website"
                  type="url"
                  value={vendorWebsite}
                  onChange={(e) => setVendorWebsite(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500"
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
              >
                Add Vendor
              </button>
            </form>
          </div>

          {/* Recent Risk Alerts Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 text-xl font-semibold text-slate-900 dark:text-white">
              Recent Risk Alerts
            </h2>
            <ul className="space-y-3">
              {MOCK_RISK_ALERTS.map((alert) => (
                <li
                  key={alert.id}
                  className="rounded-lg border border-slate-200 p-4 dark:border-slate-700"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900 dark:text-white">
                        {alert.vendor}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                        {alert.message}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${severityStyles[alert.severity as keyof typeof severityStyles]}`}
                    >
                      {alert.severity}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">
                    {alert.timestamp}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
