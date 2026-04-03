import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ShieldCheck,
  Mail,
  Globe,
  Server,
  Loader2,
  ArrowRight,
  Upload,
  Download,
  Trash2,
  AlertTriangle,
  HelpCircle,
  FileText,
} from "lucide-react";
import axios from "axios";



type EmailStatus = "Valid" | "Invalid" | "Risky" | "Unknown";

interface VerificationDetails {
  syntax: boolean;
  dns: boolean;
  smtp: boolean;
  catchAll: boolean;
  mxRecords: Array<{ exchange: string; priority: number }>;
}

interface EmailVerificationResult {
  email: string;
  status: EmailStatus;
  reason: string;
  domain: string;
  providerType: string;
  details: VerificationDetails;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
const STATUS_CONFIG: Record<
  EmailStatus,
  { label: string; icon: React.ReactNode; pill: string; dot: string }
> = {
  Valid: {
    label: "Valid",
    icon: <CheckCircle2 className="w-4 h-4" />,
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  Invalid: {
    label: "Invalid",
    icon: <XCircle className="w-4 h-4" />,
    pill: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-500",
  },
  Risky: {
    label: "Risky",
    icon: <AlertTriangle className="w-4 h-4" />,
    pill: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
  },
  Unknown: {
    label: "Unknown",
    icon: <HelpCircle className="w-4 h-4" />,
    pill: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-400",
  },
};

const PROVIDER_LABEL: Record<string, string> = {
  free: "Free Provider",
  disposable: "Disposable / Temp",
  educational: "Educational",
  business: "Business Domain",
  unknown: "Unknown",
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EmailVerificationResult | null>(null);
  const [bulkResults, setBulkResults] = useState<EmailVerificationResult[]>([]);
  const [bulkInput, setBulkInput] = useState("");
  const [bulkProgress, setBulkProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // Single verification
  // -------------------------------------------------------------------------
  const validateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await axios.post<EmailVerificationResult>("/api/verify", {
        email: email.trim(),
      });
      setResult(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to verify email.");
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Bulk verification (shared logic for textarea + file upload)
  // -------------------------------------------------------------------------
  const runBulkVerification = async (rawEmails: string[]) => {
    const emails = rawEmails
      .map((e) => e.trim())
      .filter((e) => e.includes("@"))
      .slice(0, 1000);

    if (emails.length === 0) {
      setError("No valid email addresses found.");
      return;
    }

    setLoading(true);
    setBulkProgress(0);
    setError(null);
    setBulkResults([]);

    try {
      const response = await axios.post<{ results: EmailVerificationResult[]; total: number }>(
        "/api/verify-bulk",
        { emails },
        {
          onDownloadProgress: (e) => {
            if (e.total) setBulkProgress(Math.round((e.loaded / e.total) * 100));
          },
        }
      );
      setBulkResults(response.data.results);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to process bulk list.");
    } finally {
      setLoading(false);
      setBulkProgress(null);
    }
  };

  const handleBulkTextSubmit = () => {
    const emails = bulkInput.split(/[\n,;]/).map((e) => e.trim()).filter(Boolean);
    runBulkVerification(emails);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const emails = text.split(/[\n,;]/).map((e) => e.trim()).filter(Boolean);
      runBulkVerification(emails);
    };
    reader.readAsText(file);
    // Reset so same file can be re-uploaded
    e.target.value = "";
  };



  // -------------------------------------------------------------------------
  // CSV export
  // -------------------------------------------------------------------------
  const downloadCSV = () => {
    const headers = "Email,Status,Domain,Provider Type,Syntax,DNS,SMTP,Catch-All,Reason\n";
    const rows = bulkResults
      .map(
        (r) =>
          `"${r.email}","${r.status}","${r.domain}","${r.providerType}",` +
          `${r.details.syntax},${r.details.dns},${r.details.smtp},${r.details.catchAll},` +
          `"${(r.reason || "").replace(/"/g, '""')}"`
      )
      .join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "verifeye_results.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------
  const stats = {
    total: bulkResults.length,
    valid: bulkResults.filter((r) => r.status === "Valid").length,
    invalid: bulkResults.filter((r) => r.status === "Invalid").length,
    risky: bulkResults.filter((r) => r.status === "Risky").length,
    unknown: bulkResults.filter((r) => r.status === "Unknown").length,
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#F7F7F5] text-[#1A1A1A] font-sans selection:bg-emerald-100">
      {/* Header */}
      <nav className="max-w-4xl mx-auto px-6 py-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center shadow-sm">
            <ShieldCheck className="text-white w-5 h-5" />
          </div>
          <span className="font-semibold text-xl tracking-tight">VerifEye</span>
        </div>
        <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-full p-1 shadow-sm">
          {(["single", "bulk"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`text-xs font-mono uppercase tracking-widest px-4 py-1.5 rounded-full transition-all ${
                mode === m
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-700"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 pb-24">
        {/* Hero */}
        <section className="mt-10 mb-14 text-center md:text-left">
          <motion.h1
            key={mode}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="text-4xl md:text-5xl font-medium tracking-tight mb-4 leading-tight"
          >
            {mode === "single" ? (
              <>
                Validate any email
                <br />
                <span className="text-zinc-400 italic">with absolute precision.</span>
              </>
            ) : (
              <>
                Bulk verification
                <br />
                <span className="text-zinc-400 italic">process thousands in seconds.</span>
              </>
            )}
          </motion.h1>
        </section>

        {/* Input Section */}
        <section className="mb-10">
          {mode === "single" ? (
            <form onSubmit={validateEmail} className="relative group">
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address (e.g. hello@company.com)"
                className="w-full bg-white border border-zinc-200 rounded-2xl px-6 py-5 pr-16 text-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-zinc-300"
              />
              <button
                type="submit"
                disabled={loading || !email}
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-200 text-white p-3 rounded-xl transition-all shadow-md shadow-emerald-600/20"
              >
                {loading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <ArrowRight className="w-6 h-6" />
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {/* Textarea */}
              <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm">
                <label className="block text-xs font-mono text-zinc-400 uppercase tracking-widest mb-2">
                  Paste emails (one per line, comma or semicolon separated)
                </label>
                <textarea
                  rows={5}
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  placeholder="user@example.com&#10;another@company.org&#10;test@gmail.com"
                  className="w-full text-sm font-mono text-zinc-700 placeholder:text-zinc-300 resize-none focus:outline-none"
                />
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100">
                  <span className="text-xs text-zinc-400">
                    {bulkInput.split(/[\n,;]/).filter((e) => e.trim().includes("@")).length} emails
                    detected
                  </span>
                  <button
                    onClick={handleBulkTextSubmit}
                    disabled={loading || !bulkInput.trim()}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-200 text-white text-sm px-4 py-2 rounded-xl transition-all font-medium"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                    Verify All
                  </button>
                </div>
              </div>

              {/* File upload */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-full bg-white border-2 border-dashed border-zinc-200 rounded-2xl p-8 flex items-center justify-center gap-4 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/20 transition-all group"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                  accept=".csv,.txt"
                />
                <div className="w-10 h-10 bg-zinc-50 rounded-xl flex items-center justify-center group-hover:bg-emerald-100 transition-all flex-shrink-0">
                  <Upload className="w-5 h-5 text-zinc-400 group-hover:text-emerald-600" />
                </div>
                <div>
                  <p className="font-medium text-sm">Upload CSV or TXT file</p>
                  <p className="text-zinc-400 text-xs">One email per line or comma-separated · up to 1,000 emails</p>
                </div>
              </div>

              {/* Progress bar */}
              {loading && (
                <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-zinc-700">Processing…</span>
                    {bulkProgress !== null && (
                      <span className="text-xs text-zinc-400">{bulkProgress}%</span>
                    )}
                  </div>
                  <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-emerald-500 rounded-full"
                      initial={{ width: "0%" }}
                      animate={{ width: bulkProgress !== null ? `${bulkProgress}%` : "100%" }}
                      transition={{ duration: bulkProgress !== null ? 0.1 : 2, ease: "easeInOut" }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex items-center gap-2 text-red-500 text-sm px-1"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </motion.div>
          )}
        </section>

        {/* ----------------------------------------------------------------- */}
        {/* Results                                                            */}
        {/* ----------------------------------------------------------------- */}
        <AnimatePresence mode="wait">
          {/* Single result */}
          {mode === "single" && result && (
            <motion.div
              key="single-result"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-6"
            >
              {/* Main card */}
              <div className="md:col-span-2 bg-white rounded-3xl p-8 shadow-sm border border-zinc-100">
                <div className="flex items-start justify-between mb-8 gap-4">
                  <div className="min-w-0">
                    <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest mb-1">
                      Verification Result
                    </h2>
                    <p className="text-xl font-medium break-all">{result.email}</p>
                  </div>
                  <StatusBadge status={result.status} />
                </div>

                {/* Check rows */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <CheckRow
                    icon={<Mail className="w-3 h-3" />}
                    label="Syntax"
                    ok={result.details.syntax}
                    okText="Valid Format"
                    failText="Invalid Format"
                  />
                  <CheckRow
                    icon={<Globe className="w-3 h-3" />}
                    label="DNS / MX"
                    ok={result.details.dns}
                    okText="MX Found"
                    failText="No MX Records"
                  />
                  <CheckRow
                    icon={<Server className="w-3 h-3" />}
                    label="SMTP Server"
                    ok={result.details.smtp}
                    warnIfFalse
                    okText="Accepted"
                    failText={result.details.smtp === false && !result.details.dns ? "N/A" : "Blocked / Rejected"}
                  />
                </div>

                {/* Reason */}
                {result.reason && (
                  <div className="mt-6 p-4 bg-zinc-50 rounded-2xl text-sm text-zinc-600 border border-zinc-100">
                    {result.reason}
                  </div>
                )}


              </div>

              {/* Sidebar */}
              <div className="space-y-4">
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-zinc-100">
                  <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-widest mb-4">
                    Domain Info
                  </h3>
                  <div className="space-y-4">
                    <InfoRow label="Domain" value={result.domain || result.email.split("@")[1]} />
                    <InfoRow
                      label="Provider"
                      value={PROVIDER_LABEL[result.providerType] ?? result.providerType}
                    />
                    {result.details.mxRecords.length > 0 && (
                      <InfoRow
                        label="Primary MX"
                        mono
                        value={result.details.mxRecords[0].exchange}
                      />
                    )}
                    <InfoRow
                      label="Catch-All"
                      value={result.details.catchAll ? "Yes (risky)" : "No"}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Bulk results */}
          {mode === "bulk" && bulkResults.length > 0 && (
            <motion.div
              key="bulk-result"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="bg-white rounded-3xl shadow-sm border border-zinc-100 overflow-hidden"
            >
              {/* Stats bar */}
              <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-zinc-100 border-b border-zinc-100">
                {(
                  [
                    { label: "Total", value: stats.total, color: "text-zinc-700" },
                    { label: "Valid", value: stats.valid, color: "text-emerald-600" },
                    { label: "Invalid", value: stats.invalid, color: "text-red-500" },
                    { label: "Risky", value: stats.risky, color: "text-amber-500" },
                    { label: "Unknown", value: stats.unknown, color: "text-blue-500" },
                  ] as const
                ).map((s) => (
                  <div key={s.label} className="px-5 py-4">
                    <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-0.5">
                      {s.label}
                    </p>
                    <p className={`text-2xl font-semibold ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="px-6 py-4 flex items-center justify-between bg-zinc-50/40 border-b border-zinc-100">
                <span className="text-sm text-zinc-500">
                  <FileText className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                  {stats.total} emails processed
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={downloadCSV}
                    className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-emerald-700 transition-all shadow-sm"
                  >
                    <Download className="w-4 h-4" /> Export CSV
                  </button>
                  <button
                    onClick={() => { setBulkResults([]); setBulkInput(""); }}
                    className="p-2 text-zinc-400 hover:text-red-500 transition-all"
                    title="Clear results"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50/30">
                      {["Email Address", "Status", "Domain", "Provider", "Reason"].map((h) => (
                        <th
                          key={h}
                          className="px-6 py-4 text-[10px] font-mono text-zinc-400 uppercase tracking-widest whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {bulkResults.map((r, i) => (
                      <tr key={i} className="hover:bg-zinc-50/50 transition-all">
                        <td className="px-6 py-3 text-sm font-medium">{r.email}</td>
                        <td className="px-6 py-3">
                          <StatusBadge status={r.status} small />
                        </td>
                        <td className="px-6 py-3 text-xs text-zinc-500 font-mono">{r.domain}</td>
                        <td className="px-6 py-3 text-xs text-zinc-500 capitalize">
                          {PROVIDER_LABEL[r.providerType] ?? r.providerType}
                        </td>
                        <td className="px-6 py-3 text-xs text-zinc-400 italic max-w-xs truncate" title={r.reason}>
                          {r.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {!result && bulkResults.length === 0 && !loading && (
          <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 opacity-40 grayscale pointer-events-none">
            {[
              { icon: <ShieldCheck className="w-7 h-7" />, label: "Secure Verification" },
              { icon: <Globe className="w-7 h-7" />, label: "Global DNS Check" },
              { icon: <Server className="w-7 h-7" />, label: "SMTP Handshake" },
            ].map(({ icon, label }) => (
              <div
                key={label}
                className="p-6 rounded-2xl border border-zinc-200 border-dashed flex flex-col items-center text-center gap-3"
              >
                {icon}
                <p className="text-xs font-medium">{label}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-6 py-10 border-t border-zinc-200 flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-zinc-400 text-xs">© 2025 VerifEye. Built for modern deliverability.</p>
        <div className="flex items-center gap-6">
          <a href="#" className="text-zinc-400 hover:text-emerald-600 text-xs transition-colors">Privacy</a>
          <a href="#" className="text-zinc-400 hover:text-emerald-600 text-xs transition-colors">Documentation</a>
          <a href="#" className="text-zinc-400 hover:text-emerald-600 text-xs transition-colors">API</a>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function StatusBadge({ status, small }: { status: EmailStatus; small?: boolean }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <div
      className={`inline-flex items-center gap-1.5 border rounded-full font-semibold uppercase tracking-wider whitespace-nowrap ${
        small ? "px-2 py-0.5 text-[10px]" : "px-3 py-1.5 text-xs"
      } ${cfg.pill}`}
    >
      {cfg.icon}
      {cfg.label}
    </div>
  );
}

function CheckRow({
  icon,
  label,
  ok,
  okText,
  failText,
  warnIfFalse = false,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
  okText: string;
  failText: string;
  warnIfFalse?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] uppercase tracking-wider font-semibold">
        {icon} {label}
      </div>
      <div className="flex items-center gap-2 text-sm font-medium">
        {ok ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
        ) : warnIfFalse ? (
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
        )}
        {ok ? okText : failText}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] text-zinc-400 uppercase font-bold mb-0.5">{label}</p>
      <p
        className={`text-sm font-medium truncate ${mono ? "font-mono text-zinc-500 text-xs" : ""}`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
