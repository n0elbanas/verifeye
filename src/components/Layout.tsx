import React from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { ShieldCheck, Settings, FileText, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

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
          
          {user && (
            <div className="flex items-center gap-4">
              <div className="text-xs text-zinc-500 hidden sm:flex items-center gap-3">
                <span>
                  {user.email} <span className="uppercase text-[9px] bg-zinc-100 px-1.5 py-0.5 rounded font-mono ml-1">{user.role}</span>
                </span>
                <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-1 rounded-full font-mono text-[10px]" title="Daily Verification Limit">
                  <span className="font-medium">
                    {user.emails_checked_today ?? 0}
                  </span>
                  <span className="opacity-50">/</span>
                  <span className="font-medium">
                    {user.daily_limit === -1 ? '∞' : user.daily_limit}
                  </span>
                </div>
              </div>
              <Link to="/logs" className="p-2 text-zinc-400 hover:text-emerald-600 transition-colors" title="Audit Logs">
                <FileText className="w-5 h-5" />
              </Link>
              <Link to="/settings" className="p-2 text-zinc-400 hover:text-emerald-600 transition-colors" title="Settings">
                <Settings className="w-5 h-5" />
              </Link>
              <button onClick={handleLogout} className="p-2 text-zinc-400 hover:text-red-500 transition-colors" title="Log Out">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          )}
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
