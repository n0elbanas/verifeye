import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Server,
  Mail,
  Zap,
  RotateCcw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Loader2,
  RefreshCw,
  Database,
  ShieldCheck,
} from 'lucide-react';

interface SystemStatus {
  mailerEnabled: boolean;
  abstractApiConfigured: boolean;
  totalLogs: number;
  pendingRetries: number;
  timestamp: string;
}

export default function Settings() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [clearingQueue, setClearingQueue] = useState(false);

  const fetchStatus = async () => {
    setLoading(true);
    setActionMsg(null);
    try {
      const res = await axios.get('/api/system/status');
      setStatus(res.data);
    } catch (e: any) {
      console.error(e);
      setActionMsg({ type: 'error', msg: 'Could not fetch system status' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleClearLogs = async () => {
    if (!window.confirm('Are you sure you want to clear all verification audit logs?')) return;
    setClearingLogs(true);
    setActionMsg(null);
    try {
      await axios.delete('/api/logs');
      setActionMsg({ type: 'success', msg: 'All audit logs cleared successfully.' });
      fetchStatus();
    } catch (e: any) {
      setActionMsg({ type: 'error', msg: e.response?.data?.error || 'Failed to clear logs.' });
    } finally {
      setClearingLogs(false);
    }
  };

  const handleClearRetryQueue = async () => {
    if (!window.confirm('Are you sure you want to purge all pending retry jobs?')) return;
    setClearingQueue(true);
    setActionMsg(null);
    try {
      await axios.delete('/api/retry-queue');
      setActionMsg({ type: 'success', msg: 'Retry queue cleared successfully.' });
      fetchStatus();
    } catch (e: any) {
      setActionMsg({ type: 'error', msg: e.response?.data?.error || 'Failed to clear retry queue.' });
    } finally {
      setClearingQueue(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Settings & Diagnostics</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Engine configuration, integration status, and storage maintenance.
          </p>
        </div>
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white hover:bg-zinc-50 border border-zinc-200 rounded-xl text-zinc-600 transition-colors shadow-sm disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Status
        </button>
      </div>

      {actionMsg && (
        <div
          className={`flex items-center gap-2 text-sm p-4 rounded-2xl border ${
            actionMsg.type === 'error'
              ? 'text-red-600 bg-red-50 border-red-200'
              : 'text-emerald-700 bg-emerald-50 border-emerald-200'
          }`}
        >
          {actionMsg.type === 'error' ? (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{actionMsg.msg}</span>
        </div>
      )}

      {/* Verification Engine Integrations */}
      <section className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-zinc-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-zinc-100 p-2.5 rounded-xl">
            <Server className="w-5 h-5 text-zinc-700" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Verification Engine & Integrations</h2>
            <p className="text-xs text-zinc-500">Real-time status of verification backends</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Deep Verification Mailer */}
          <div className="border border-zinc-100 bg-zinc-50/60 rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-zinc-500" />
                  <span className="text-sm font-medium">Deep Verify Mailer</span>
                </div>
                {status?.mailerEnabled ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-zinc-200/70 text-zinc-600">
                    Disabled
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Sends probe emails to risky domains with 1×1 pixel tracking. Configured via SMTP credentials in <code className="text-zinc-700 font-mono text-[11px]">.env</code>.
              </p>
            </div>
            {!status?.mailerEnabled && (
              <p className="text-[11px] text-zinc-400 mt-3 font-mono">
                Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env
              </p>
            )}
          </div>

          {/* Abstract API */}
          <div className="border border-zinc-100 bg-zinc-50/60 rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-zinc-500" />
                  <span className="text-sm font-medium">Abstract API Integration</span>
                </div>
                {status?.abstractApiConfigured ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                    Optional
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Third-party IP infrastructure verification for Yahoo and catch-all domains without local port 25 blocking.
              </p>
            </div>
            {!status?.abstractApiConfigured && (
              <p className="text-[11px] text-zinc-400 mt-3 font-mono">
                Set ABSTRACT_API_KEY in .env to enhance Yahoo checks
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Storage & Queue Statistics */}
      <section className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-zinc-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-zinc-100 p-2.5 rounded-xl">
            <Database className="w-5 h-5 text-zinc-700" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Database & Maintenance</h2>
            <p className="text-xs text-zinc-500">Audit logs and asynchronous retry queue management</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="border border-zinc-100 bg-zinc-50/60 rounded-2xl p-5">
            <span className="text-xs font-mono uppercase text-zinc-400 tracking-wider">Total Audit Logs</span>
            <div className="text-2xl font-semibold mt-1">
              {loading ? <Loader2 className="w-5 h-5 animate-spin text-zinc-400 inline" /> : status?.totalLogs ?? 0}
            </div>
            <p className="text-xs text-zinc-500 mt-1">Stored verification history records</p>
          </div>

          <div className="border border-zinc-100 bg-zinc-50/60 rounded-2xl p-5">
            <span className="text-xs font-mono uppercase text-zinc-400 tracking-wider">Pending Retry Jobs</span>
            <div className="text-2xl font-semibold mt-1">
              {loading ? <Loader2 className="w-5 h-5 animate-spin text-zinc-400 inline" /> : status?.pendingRetries ?? 0}
            </div>
            <p className="text-xs text-zinc-500 mt-1">Greylisted emails queued for re-probe</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-zinc-100">
          <button
            onClick={handleClearLogs}
            disabled={clearingLogs || (status?.totalLogs === 0)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded-xl transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {clearingLogs ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Clear All Audit Logs
          </button>

          <button
            onClick={handleClearRetryQueue}
            disabled={clearingQueue || (status?.pendingRetries === 0)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 border border-zinc-200 rounded-xl transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {clearingQueue ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            Purge Retry Queue
          </button>
        </div>
      </section>

      {/* System Guidelines & Network Note */}
      <section className="bg-zinc-50 rounded-2xl p-6 border border-zinc-200/60 text-xs text-zinc-500 space-y-2">
        <div className="flex items-center gap-2 font-medium text-zinc-700">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Local & VPS Deliverability Notes</span>
        </div>
        <p>
          Residential ISPs and consumer cloud environments frequently block outbound port 25. VerifEye automatically falls back to port 587 and classifies deferred connections as <span className="font-semibold text-zinc-700">Unknown</span> or <span className="font-semibold text-zinc-700">Risky</span> rather than falsely failing them.
        </p>
        <p>
          For production grade verification, deploy on an unblocked VPS host with reverse DNS (PTR) records configured.
        </p>
      </section>
    </div>
  );
}
