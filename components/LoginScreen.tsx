/**
 * LoginScreen — name + email sign-in (no passwords by design).
 * Kids NEVER get accounts (COPPA); the Terms of Service require 13+.
 */
import React, { useState } from 'react';
import { TrendingDown, Mail, User, ArrowRight, ShieldCheck } from 'lucide-react';
import { signIn } from '../services/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Please enter your name.'); return; }
    if (!EMAIL_RE.test(email.trim())) { setError('Please enter a valid email address.'); return; }
    signIn(name, email);
    // auth.onAuthChange in App.tsx picks up the session and flips the UI.
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
      <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 md:p-10 animate-slide-up">
        <div className="flex items-center justify-center gap-2 mb-8">
          <TrendingDown className="text-[#E31837]" size={24} />
          <h1 className="text-2xl font-black tracking-tighter italic text-[#003366]">C-SHOPPER</h1>
        </div>
        <h2 className="text-xl font-black text-slate-900 tracking-tighter text-center mb-2 uppercase">Welcome back</h2>
        <p className="text-slate-400 font-medium text-sm text-center mb-8">
          Sign in with your name and email to track prices and join the community.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="w-full pl-11 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm outline-none focus:ring-2 ring-[#003366]/20"
            />
          </div>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full pl-11 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm outline-none focus:ring-2 ring-[#003366]/20"
            />
          </div>
          {error && <p className="text-xs font-bold text-red-500 text-center">{error}</p>}
          <button
            type="submit"
            className="w-full py-4 bg-[#003366] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            Continue <ArrowRight size={16} />
          </button>
        </form>
        <div className="mt-6 flex items-start gap-2 bg-slate-50 rounded-2xl p-4">
          <ShieldCheck size={16} className="text-[#003366] shrink-0 mt-0.5" />
          <p className="text-[10px] font-bold text-slate-400 leading-relaxed uppercase">
            13+ only. Kids never get accounts. Your details stay on this device.
          </p>
        </div>
      </div>
    </div>
  );
}
