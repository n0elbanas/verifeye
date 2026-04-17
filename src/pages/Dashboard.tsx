import React, { useState, useRef, useEffect, useCallback } from "react";
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
  Wand2,
  Send,
  RefreshCw,
  Tag,
  Zap,
} from "lucide-react";
import axios from "axios";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type EmailStatus = "Valid" | "Invalid" | "Risky" | "Unknown";

interface VerificationDetails {
  syntax: boolean;
  dns: boolean;
  smtp: boolean;
  catchAll: boolean;
  mxRecords: Array<{ exchange: string; priority: number }>;
  smtpVerdict: string;
  smtpSkipped: boolean;
}

interface EmailVerificationResult {
  email: string;
  status: EmailStatus;
  reason: string;
  domain: string;
  providerType: string;
  detectedProvider: string | null;
  confidenceScore: number;
  flags: string[];
  typoSuggestion: string | null;
  details: VerificationDetails;
  logId?: number;
}

type DeepVerifyStatus = "idle" | "loading" | "sent" | "delivered" | "bounced" | "failed" | "pending" | "sending" | "disabled" | "timeout";

interface DeepVerifyState {
  status: DeepVerifyStatus;
  queueId: number | null;
  message: string;
}

// ---------------------------------------------------------------------------
// Status configuration
// ---------------------------------------------------------------------------
const STATUS_CONFIG: Record<
  EmailStatus,
  { label: string; icon: React.ReactNode; pill: string; dot: string; bar: string }
> = {
  Valid: {
    label: "Valid",
    icon: <CheckCircle2 className="w-4 h-4" />,
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
  },
  Invalid: {
    label: "Invalid",
    icon: <XCircle className="w-4 h-4" />,
    pill: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-500",
    bar: "bg-red-500",
  },
  Risky: {
    label: "Risky",
    icon: <AlertTriangle className="w-4 h-4" />,
    pill: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
    bar: "bg-amber-400",
  },
  Unknown: {
    label: "Unknown",
    icon: <HelpCircle className="w-4 h-4" />,
    pill: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-400",
    bar: "bg-blue-400",
  },
};

const PROVIDER_LABEL: Record<string, string> = {
  free: "Free Provider",
  disposable: "Disposable / Temp",
  educational: "Educational",
  business: "Business Domain",
  unknown: "Unknown",
};

const DETECTED_PROVIDER_LABEL: Record<string, string> = {
  google: "Gmail / Google Workspace",
  yahoo: "Yahoo Mail",
  microsoft: "Outlook / Microsoft 365",
  icloud: "iCloud Mail",
  protonmail: "ProtonMail",
  zoho: "Zoho Mail",
};

// Flag display config
const FLAG_CONFIG: Record<string, { label: string; color: string }> = {
  disposable:      { label: "Disposable",    color: "bg-red-100 text-red-700 border-red-200" },
  role_based:      { label: "Role Address",  color: "bg-orange-100 text-orange-700 border-orange-200" },
  catch_all:       { label: "Catch-All",     color: "bg-amber-100 text-amber-700 border-amber-200" },
  free_provider:   { label: "Free Provider", color: "bg-blue-100 text-blue-700 border-blue-200" },
  possible_typo:   { label: "Possible Typo", color: "bg-purple-100 text-purple-700 border-purple-200" },
};

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

function FlagChips({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {flags.map((flag) => {
        const cfg = FLAG_CONFIG[flag];
        if (!cfg) return null;
        return (
          <span key={flag} className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cfg.color}`}>
            <Tag className="w-2.5 h-2.5" /> {cfg.label}
          </span>
        );
      })}
    </div>
  );
}

function ConfidenceBar({ score, status }: { score: number; status: EmailStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">Confidence Score</span>
        <span className="text-sm font-bold text-zinc-700">{score}<span className="text-zinc-300 font-normal">/100</span></span>
      </div>
      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${cfg.bar}`}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

function CheckRow({
  icon, label, ok, okText, failText, warnIfFalse = false,
}: {
  icon: React.ReactNode; label: string; ok: boolean;
  okText: string; failText: string; warnIfFalse?: boolean;
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

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-zinc-400 uppercase font-bold mb-0.5">{label}</p>
      <p className={`text-sm font-medium truncate ${mono ? "font-mono text-zinc-500 text-xs" : ""}`} title={value}>
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deep Verify Button + Status
// ---------------------------------------------------------------------------
function DeepVerifyPanel({
  result,
  logId,
}: {
  result: EmailVerificationResult;
  logId?: number;
}) {
  const [state, setState] = useState<DeepVerifyState>({
    status: "idle",
    queueId: null,
    message: "",
  });

  const poll = useCallback(async (queueId: number, attempt = 0) => {
    try {
      const { data } = await axios.get(`/api/verify/deep/${queueId}`);

      if (data.status === "sent" && attempt > 12) {
        setState((prev) => ({ ...prev, status: "timeout", message: "Timeout: No open detected" }));
        return;
      }

      setState((prev) => ({
        ...prev,
        status: data.status as DeepVerifyStatus,
        message: data.bounce_code ? `Bounce: ${data.bounce_code}` : "",
      }));
      // Keep polling if still in-progress
      if (["pending", "sending", "sent"].includes(data.status)) {
        setTimeout(() => poll(queueId, attempt + 1), 5000);
      }
    } catch {
      setState((prev) => ({ ...prev, status: "failed", message: "Failed to check status" }));
    }
  }, []);

  const handleDeepVerify = async () => {
    setState({ status: "loading", queueId: null, message: "" });
    try {
      const { data } = await axios.post("/api/verify/deep", {
        email: result.email,
        logId: logId ?? 0,
      });
      if (data.disabled) {
        setState({ status: "disabled", queueId: null, message: "SMTP not configured" });
        return;
      }
      setState({ status: "pending", queueId: data.queueId, message: "Email sent — waiting for delivery confirmation..." });
      // Start polling
      setTimeout(() => poll(data.queueId), 5000);
    } catch (err: any) {
      const msg = err.response?.data?.error ?? "Failed to start deep verification";
      setState({ status: "failed", queueId: null, message: msg });
    }
  };

  const statusIcons: Partial<Record<DeepVerifyStatus, React.ReactNode>> = {
    loading: <Loader2 className="w-4 h-4 animate-spin" />,
    pending: <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />,
    sending: <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />,
    sent:      <Send className="w-4 h-4 text-blue-500" />,
    delivered: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
    bounced:   <XCircle className="w-4 h-4 text-red-500" />,
    failed:    <AlertCircle className="w-4 h-4 text-red-400" />,
    disabled:  <AlertCircle className="w-4 h-4 text-zinc-400" />,
    timeout:   <AlertCircle className="w-4 h-4 text-amber-500" />,
  };

  const statusLabels: Partial<Record<DeepVerifyStatus, string>> = {
    pending:  "Email sent — awaiting open/delivery...",
    sending:  "Sending probe email...",
    sent:     "Delivered to provider. Awaiting open...",
    delivered:"✓ Email opened — address is active!",
    bounced:  `Bounced — ${state.message || "address likely invalid"}`,
    failed:   state.message || "Deep verification failed",
    disabled: "Deep verification requires SMTP credentials in .env",
    timeout:  "Delivered but unopened. Likely inactive or invalid.",
  };

  return (
    <div className="mt-4 pt-4 border-t border-zinc-100">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400 font-medium">Real-email verification</p>
        {state.status === "idle" && (
          <button
            onClick={handleDeepVerify}
            className="flex items-center gap-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg font-medium transition-all"
          >
            <Zap className="w-3.5 h-3.5" /> Deep Verify
          </button>
        )}
      </div>

      <AnimatePresence>
        {state.status !== "idle" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 flex items-center gap-2 text-xs text-zinc-600 bg-zinc-50 rounded-xl px-3 py-2.5 border border-zinc-100"
          >
            {statusIcons[state.status]}
            <span>{statusLabels[state.status] ?? state.status}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------
export default function App() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<(EmailVerificationResult & { logId?: number }) | null>(null);
  const [bulkResults, setBulkResults] = useState<EmailVerificationResult[]>([]);
  const [bulkInput, setBulkInput] = useState("");
  const [bulkProgress, setBulkProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Single verification ────────────────────────────────────────────────────
  const validateEmail = async (emailToVerify?: string) => {
    const target = emailToVerify ?? email;
    if (!target) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await axios.post<EmailVerificationResult & { logId?: number }>("/api/verify", {
        email: target.trim(),
      });
      // Auto-apply typo suggestion if one was detected and the email differs
      setResult(response.data);
      if (emailToVerify) setEmail(emailToVerify);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to verify email.");
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    validateEmail();
  };

  // ── Apply typo suggestion ─────────────────────────────────────────────────
  const applyTypoSuggestion = () => {
    if (!result?.typoSuggestion) return;
    const corrected = result.email.split("@")[0] + "@" + result.typoSuggestion;
    setEmail(corrected);
    validateEmail(corrected);
  };

  // ── Bulk verification ─────────────────────────────────────────────────────
  const runBulkVerification = async (rawEmails: string[]) => {
    const emails = rawEmails.map((e) => e.trim()).filter((e) => e.includes("@")).slice(0, 1000);
    if (emails.length === 0) { setError("No valid email addresses found."); return; }

    setLoading(true);
    setBulkProgress(0);
    setError(null);
    setBulkResults([]);

    try {
      const response = await axios.post<{ results: EmailVerificationResult[]; total: number }>(
        "/api/verify-bulk",
        { emails },
        { onDownloadProgress: (e) => { if (e.total) setBulkProgress(Math.round((e.loaded / e.total) * 100)); } }
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
    e.target.value = "";
  };

  // ── CSV export ────────────────────────────────────────────────────────────
  const downloadCSV = () => {
    const headers = "Email,Status,Confidence,Domain,Provider,Flags,Syntax,DNS,SMTP,Catch-All,Typo Suggestion,Reason\n";
    const rows = bulkResults
      .map(
        (r) =>
          `"${r.email}","${r.status}",${r.confidenceScore},"${r.domain}","${r.providerType}",` +
          `"${(r.flags ?? []).join("|")}",` +
          `${r.details.syntax},${r.details.dns},${r.details.smtp},${r.details.catchAll},` +
          `"${r.typoSuggestion ?? ""}","${(r.reason || "").replace(/"/g, '""')}"`
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

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = {
    total: bulkResults.length,
    valid: bulkResults.filter((r) => r.status === "Valid").length,
    invalid: bulkResults.filter((r) => r.status === "Invalid").length,
    risky: bulkResults.filter((r) => r.status === "Risky").length,
    unknown: bulkResults.filter((r) => r.status === "Unknown").length,
  };

  // ── SMTP verdict label (human-readable for the sidebar) ───────────────────
  const smtpVerdictLabel: Record<string, string> = {
    accepted: "Accepted",
    catch_all: "Catch-All",
    invalid_mailbox: "Rejected (5.1.x)",
    policy_block: "Policy Block (5.7.x)",
    greylisted: "Greylisted (4xx)",
    blocked: "Port Blocked",
    timeout: "Timeout",
    error: "Error",
    skipped_blocking_provider: "Skipped (Blocked Provider)",
    not_run: "Not Run",
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="w-full">
      {/* Mode toggle */}
      <div className="max-w-4xl mx-auto px-6 pt-6 pb-2 flex justify-end">
        <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-full p-1 shadow-sm">
          {(["single", "bulk"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`text-xs font-mono uppercase tracking-widest px-4 py-1.5 rounded-full transition-all ${
                mode === m ? "bg-emerald-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-700"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

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

        {/* Input section */}
        <section className="mb-10">
          {mode === "single" ? (
            <form onSubmit={handleFormSubmit} className="relative group">
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email address (e.g. hello@company.com)"
                className="w-full bg-white border border-zinc-200 rounded-2xl px-6 py-5 pr-28 text-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-zinc-300"
              />
              {email && (
                <button
                  type="button"
                  onClick={() => { setEmail(""); setResult(null); }}
                  className="absolute right-[4.5rem] top-1/2 -translate-y-1/2 p-2 text-zinc-300 hover:text-zinc-500 transition-colors"
                  title="Clear"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              )}
              <button
                type="submit"
                disabled={loading || !email}
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-200 text-white p-3 rounded-xl transition-all shadow-md shadow-emerald-600/20"
              >
                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <ArrowRight className="w-6 h-6" />}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm">
                <label className="block text-xs font-mono text-zinc-400 uppercase tracking-widest mb-2">
                  Paste emails (one per line, comma or semicolon separated)
                </label>
                <textarea
                  rows={5}
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  placeholder={"user@example.com\nanother@company.org\ntest@gmail.com"}
                  className="w-full text-sm font-mono text-zinc-700 placeholder:text-zinc-300 resize-none focus:outline-none"
                />
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100">
                  <span className="text-xs text-zinc-400">
                    {bulkInput.split(/[\n,;]/).filter((e) => e.trim().includes("@")).length} emails detected
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
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".csv,.txt" />
                <div className="w-10 h-10 bg-zinc-50 rounded-xl flex items-center justify-center group-hover:bg-emerald-100 transition-all flex-shrink-0">
                  <Upload className="w-5 h-5 text-zinc-400 group-hover:text-emerald-600" />
                </div>
                <div>
                  <p className="font-medium text-sm">Upload CSV or TXT file</p>
                  <p className="text-zinc-400 text-xs">One email per line or comma-separated · up to 1,000 emails</p>
                </div>
              </div>

              {loading && (
                <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-zinc-700">Processing…</span>
                    {bulkProgress !== null && <span className="text-xs text-zinc-400">{bulkProgress}%</span>}
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
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </motion.div>
          )}
        </section>

        {/* Results */}
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
                {/* Header */}
                <div className="flex items-start justify-between mb-6 gap-4">
                  <div className="min-w-0">
                    <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest mb-1">
                      Verification Result
                    </h2>
                    <p className="text-xl font-medium break-all">{result.email}</p>
                    <FlagChips flags={result.flags ?? []} />
                  </div>
                  <StatusBadge status={result.status} />
                </div>

                {/* Typo suggestion */}
                <AnimatePresence>
                  {result.typoSuggestion && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-5 flex items-center justify-between gap-3 bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3"
                    >
                      <div className="flex items-center gap-2 text-sm text-purple-700">
                        <Wand2 className="w-4 h-4 flex-shrink-0" />
                        <span>Did you mean <strong>{result.email.split("@")[0]}@{result.typoSuggestion}</strong>?</span>
                      </div>
                      <button
                        onClick={applyTypoSuggestion}
                        className="text-xs font-semibold text-purple-700 bg-white border border-purple-200 rounded-lg px-3 py-1.5 hover:bg-purple-100 transition-all whitespace-nowrap"
                      >
                        Use this →
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Check rows */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <CheckRow icon={<Mail className="w-3 h-3" />} label="Syntax" ok={result.details.syntax} okText="Valid Format" failText="Invalid Format" />
                  <CheckRow icon={<Globe className="w-3 h-3" />} label="DNS / MX" ok={result.details.dns} okText="MX Found" failText="No MX Records" />
                  <CheckRow
                    icon={<Server className="w-3 h-3" />}
                    label="SMTP"
                    ok={result.details.smtp}
                    warnIfFalse
                    okText="Accepted"
                    failText={result.details.smtpSkipped ? "Skipped (Provider Blocks)" : "Blocked / Rejected"}
                  />
                </div>

                {/* Confidence bar */}
                <ConfidenceBar score={result.confidenceScore} status={result.status} />

                {/* Reason */}
                {result.reason && (
                  <div className="mt-5 p-4 bg-zinc-50 rounded-2xl text-sm text-zinc-600 border border-zinc-100 leading-relaxed">
                    {result.reason}
                  </div>
                )}

                {/* Deep verify — only show for Risky/Unknown */}
                {(result.status === "Risky" || result.status === "Unknown") && (
                  <DeepVerifyPanel result={result} logId={result.logId} />
                )}
              </div>

              {/* Sidebar */}
              <div className="space-y-4">
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-zinc-100">
                  <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-widest mb-4">Domain Info</h3>
                  <div className="space-y-4">
                    <InfoRow label="Domain" value={result.domain || result.email.split("@")[1]} />
                    <InfoRow label="Provider Type" value={PROVIDER_LABEL[result.providerType] ?? result.providerType} />
                    {result.detectedProvider && (
                      <InfoRow label="Mail Platform" value={DETECTED_PROVIDER_LABEL[result.detectedProvider] ?? result.detectedProvider} />
                    )}
                    {result.details.mxRecords.length > 0 && (
                      <InfoRow label="Primary MX" mono value={result.details.mxRecords.sort((a,b)=>a.priority-b.priority)[0].exchange} />
                    )}
                    <InfoRow label="Catch-All" value={result.details.catchAll ? "Yes (risky)" : "No"} />
                    <InfoRow
                      label="SMTP Verdict"
                      value={smtpVerdictLabel[result.details.smtpVerdict] ?? result.details.smtpVerdict}
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
                    <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-0.5">{s.label}</p>
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
                      {["Email Address", "Status", "Score", "Flags", "Domain", "Provider", "Reason"].map((h) => (
                        <th key={h} className="px-6 py-4 text-[10px] font-mono text-zinc-400 uppercase tracking-widest whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {bulkResults.map((r, i) => (
                      <tr key={i} className="hover:bg-zinc-50/50 transition-all">
                        <td className="px-6 py-3 text-sm font-medium">
                          {r.email}
                          {r.typoSuggestion && (
                            <span className="ml-2 text-[10px] text-purple-500 font-semibold">
                              → {r.typoSuggestion}?
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3"><StatusBadge status={r.status} small /></td>
                        <td className="px-6 py-3">
                          <span className={`text-sm font-bold ${STATUS_CONFIG[r.status].dot.replace("bg-", "text-")}`}>
                            {r.confidenceScore}
                          </span>
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {(r.flags ?? []).map((f) => (
                              <span key={f} className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded-full border ${FLAG_CONFIG[f]?.color ?? "bg-zinc-100 text-zinc-500"}`}>
                                {FLAG_CONFIG[f]?.label ?? f}
                              </span>
                            ))}
                          </div>
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
              <div key={label} className="p-6 rounded-2xl border border-zinc-200 border-dashed flex flex-col items-center text-center gap-3">
                {icon}
                <p className="text-xs font-medium">{label}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
