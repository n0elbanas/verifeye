import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { ShieldCheck, Settings, FileText, CheckCircle2 } from 'lucide-react';

export default function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#F7F7F5] text-[#1A1A1A] font-sans selection:bg-emerald-100 flex flex-col">
      {/* Top Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center shadow-sm">
              <ShieldCheck className="text-white w-5 h-5" />
            </div>
            <span className="font-semibold text-xl tracking-tight">VerifEye</span>
          </Link>
          
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/"
              className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-colors flex items-center gap-1.5 ${
                location.pathname === '/'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-semibold'
                  : 'text-zinc-600 hover:text-emerald-600 hover:bg-zinc-50'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Verifier</span>
            </Link>
            <Link
              to="/logs"
              className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-colors flex items-center gap-1.5 ${
                location.pathname === '/logs'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-semibold'
                  : 'text-zinc-600 hover:text-emerald-600 hover:bg-zinc-50'
              }`}
              title="Audit Logs"
            >
              <FileText className="w-4 h-4" />
              <span>Audit Logs</span>
            </Link>
            <Link
              to="/settings"
              className={`p-2 text-zinc-500 hover:text-emerald-600 hover:bg-zinc-50 rounded-xl transition-colors ${
                location.pathname === '/settings' ? 'bg-zinc-100 text-emerald-600' : ''
              }`}
              title="Settings & Diagnostics"
            >
              <Settings className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1">
        <Outlet />
      </div>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-6 py-10 w-full border-t border-zinc-200 flex flex-col md:flex-row items-center justify-between gap-4 mt-auto">
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
