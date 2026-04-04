import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { FileText, Loader2, CheckCircle2, XCircle, AlertTriangle, HelpCircle } from 'lucide-react';

export default function Logs() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await axios.get('/api/logs');
      setLogs(res.data);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'Valid': return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase font-semibold"><CheckCircle2 className="w-3 h-3"/> Valid</span>;
      case 'Invalid': return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 uppercase font-semibold"><XCircle className="w-3 h-3"/> Invalid</span>;
      case 'Risky': return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 uppercase font-semibold"><AlertTriangle className="w-3 h-3"/> Risky</span>;
      default: return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 uppercase font-semibold"><HelpCircle className="w-3 h-3"/> Unknown</span>;
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center">
          <FileText className="w-5 h-5 text-zinc-600" />
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Audit Logs</h1>
          <p className="text-zinc-500 text-sm">Recent verification history (max 500)</p>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-3xl p-1 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
        ) : logs.length === 0 ? (
          <div className="p-10 text-center text-zinc-500">No logs found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-zinc-50/50 border-b border-zinc-100">
                  <th className="px-6 py-4 text-[10px] uppercase font-mono text-zinc-400 tracking-widest whitespace-nowrap">ID</th>
                  <th className="px-6 py-4 text-[10px] uppercase font-mono text-zinc-400 tracking-widest whitespace-nowrap">Timestamp</th>
                  {user?.role === 'ADMIN' && <th className="px-6 py-4 text-[10px] uppercase font-mono text-zinc-400 tracking-widest whitespace-nowrap">Verified By</th>}
                  <th className="px-6 py-4 text-[10px] uppercase font-mono text-zinc-400 tracking-widest whitespace-nowrap">Email</th>
                  <th className="px-6 py-4 text-[10px] uppercase font-mono text-zinc-400 tracking-widest whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-zinc-50/30 transition-colors">
                    <td className="px-6 py-3 text-xs text-zinc-400 font-mono">#{log.id}</td>
                    <td className="px-6 py-3 text-sm text-zinc-600 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                    {user?.role === 'ADMIN' && <td className="px-6 py-3 text-sm text-zinc-500">{log.checked_by}</td>}
                    <td className="px-6 py-3 text-sm font-medium">{log.email}</td>
                    <td className="px-6 py-3">{getStatusBadge(log.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
