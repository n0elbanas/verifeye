import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { KeyRound, Users, Plus, Loader2, AlertCircle, CheckCircle2, Trash2, Key } from 'lucide-react';

export default function Settings() {
  const { user } = useAuth();
  
  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwdStatus, setPwdStatus] = useState<{type: 'error' | 'success', msg: string} | null>(null);
  
  // Admin state
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newLimit, setNewLimit] = useState('-1');
  const [adminStatus, setAdminStatus] = useState<{type: 'error' | 'success', msg: string} | null>(null);

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      fetchUsers();
    }
  }, [user]);

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await axios.get('/api/users');
      setUsers(res.data);
    } catch(e) { console.error(e); }
    finally { setLoadingUsers(false); }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdStatus(null);
    try {
      await axios.put('/api/users/password', { currentPassword, newPassword });
      setPwdStatus({ type: 'success', msg: 'Password updated successfully!' });
      setCurrentPassword('');
      setNewPassword('');
    } catch(err: any) {
      setPwdStatus({ type: 'error', msg: err.response?.data?.error || 'Failed to update password' });
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminStatus(null);
    try {
      await axios.post('/api/users', { email: newEmail, password: newPwd, limit: newLimit });
      setAdminStatus({ type: 'success', msg: 'User created successfully!' });
      setNewEmail(''); setNewPwd(''); setNewLimit('-1');
      fetchUsers();
    } catch(err: any) {
      setAdminStatus({ type: 'error', msg: err.response?.data?.error || 'Failed to create user' });
    }
  };

  const handleLimitChange = async (id: number, newLim: string) => {
    try {
      await axios.put(`/api/users/${id}/limit`, { daily_limit: parseInt(newLim) });
      fetchUsers();
    } catch(err) {
      alert("Failed to update limit");
    }
  };

  const handleDeleteUser = async (id: number, email: string) => {
    if (!window.confirm(`Are you sure you want to delete user ${email}?`)) return;
    try {
      await axios.delete(`/api/users/${id}`);
      fetchUsers();
    } catch(err) {
      alert("Failed to delete user");
    }
  };

  const handleAdminPasswordChange = async (id: number, email: string) => {
    const newPwd = window.prompt(`Enter new password for ${email}:`);
    if (!newPwd) return;
    try {
      await axios.put(`/api/users/${id}/password`, { newPassword: newPwd });
      alert("Password updated successfully!");
    } catch(err) {
      alert("Failed to update password");
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>

      <section className="bg-white rounded-3xl p-8 shadow-sm border border-zinc-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-zinc-100 p-2 rounded-xl"><KeyRound className="w-5 h-5 text-zinc-600" /></div>
          <h2 className="text-xl font-medium tracking-tight">Change Password</h2>
        </div>
        
        <form onSubmit={handlePasswordChange} className="space-y-4 max-w-sm">
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-zinc-500 mb-2">Current Password</label>
            <input 
              type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-zinc-500 mb-2">New Password</label>
            <input 
              type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={6}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>
          
          {pwdStatus && (
            <div className={`flex items-center gap-2 text-sm p-3 rounded-xl border ${pwdStatus.type === 'error' ? 'text-red-500 bg-red-50 border-red-100' : 'text-emerald-600 bg-emerald-50 border-emerald-100'}`}>
              {pwdStatus.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />} {pwdStatus.msg}
            </div>
          )}

          <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl px-6 py-2.5 transition-all">
            Update Password
          </button>
        </form>
      </section>

      {user?.role === 'ADMIN' && (
        <section className="bg-white rounded-3xl p-8 shadow-sm border border-zinc-200">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-zinc-100 p-2 rounded-xl"><Users className="w-5 h-5 text-zinc-600" /></div>
              <h2 className="text-xl font-medium tracking-tight">User Management</h2>
            </div>
          </div>

          <div className="bg-zinc-50 rounded-2xl p-6 border border-zinc-100 mb-8">
            <h3 className="text-sm font-semibold mb-4">Add New User</h3>
            <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div>
                <label className="block text-xs font-mono uppercase text-zinc-500 mb-2">Email</label>
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required className="w-full border border-zinc-200 rounded-xl px-4 py-2 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-zinc-500 mb-2">Password</label>
                <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} required minLength={6} className="w-full border border-zinc-200 rounded-xl px-4 py-2 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase text-zinc-500 mb-2">Daily Limit (-1 for unlim)</label>
                <input type="number" value={newLimit} onChange={e => setNewLimit(e.target.value)} required className="w-full border border-zinc-200 rounded-xl px-4 py-2 focus:outline-none" />
              </div>
              <button type="submit" className="bg-zinc-900 hover:bg-zinc-800 text-white font-medium rounded-xl px-4 py-2 flex items-center justify-center gap-2 h-[42px] transition-all">
                <Plus className="w-4 h-4" /> Add
              </button>
            </form>
            {adminStatus && (
              <div className={`mt-4 flex items-center gap-2 text-sm p-3 rounded-xl border ${adminStatus.type === 'error' ? 'text-red-500 bg-red-50 border-red-100' : 'text-emerald-600 bg-emerald-50 border-emerald-100'}`}>
                {adminStatus.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />} {adminStatus.msg}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-4">Existing Users</h3>
            {loadingUsers ? <Loader2 className="w-5 h-5 animate-spin text-zinc-400" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-zinc-100">
                      <th className="py-3 font-mono text-[10px] uppercase text-zinc-400">ID / Role</th>
                      <th className="py-3 font-mono text-[10px] uppercase text-zinc-400">Email</th>
                      <th className="py-3 font-mono text-[10px] uppercase text-zinc-400">Usage Today</th>
                      <th className="py-3 font-mono text-[10px] uppercase text-zinc-400">Daily Limit</th>
                      <th className="py-3 font-mono text-[10px] uppercase text-zinc-400 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {users.map(u => (
                      <tr key={u.id} className="hover:bg-zinc-50/50">
                        <td className="py-3 text-sm"><span className="text-zinc-500">#{u.id}</span> <span className="ml-2 text-[10px] font-mono bg-zinc-100 px-1.5 py-0.5 rounded uppercase">{u.role}</span></td>
                        <td className="py-3 text-sm font-medium">{u.email}</td>
                        <td className="py-3 text-sm text-zinc-500">{u.emails_checked_today}</td>
                        <td className="py-3">
                          <select 
                            value={u.daily_limit}
                            onChange={(e) => handleLimitChange(u.id, e.target.value)}
                            className="bg-zinc-50 border border-zinc-200 text-sm rounded-lg px-2 py-1 outline-none focus:border-emerald-500"
                          >
                            <option value="-1">Unlimited</option>
                            <option value="10">10</option>
                            <option value="100">100</option>
                            <option value="500">500</option>
                            <option value="1000">1000</option>
                            <option value="5000">5000</option>
                          </select>
                        </td>
                        <td className="py-3 text-right">
                          <button onClick={() => handleAdminPasswordChange(u.id, u.email)} className="p-1.5 text-zinc-400 hover:text-emerald-600 transition-colors" title="Change Password">
                            <Key className="w-4 h-4" />
                          </button>
                          {u.email !== user?.email && (
                            <button onClick={() => handleDeleteUser(u.id, u.email)} className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors" title="Delete User">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
