/**
 * LegalConsentGate — first-launch blocking consent screen.
 *
 * Shown when there is no `ws_legal_accept` record. Each of the three legal
 * documents gets its own checkbox (clearer for legal than a single "accept
 * all"); the doc text loads from /legal/*.md at runtime. "Accept & Continue"
 * enables only when all three are checked. Also exports LegalDocsViewer, a
 * read-only tabbed reader used by the Profile "Legal" row.
 */
import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, ShieldCheck, FileText, ChevronDown } from 'lucide-react';
import {
  LEGAL_DOCS, loadLegalDoc, renderMarkdown, recordLegalAcceptance,
  type LegalDoc, type LoadedLegalDoc,
} from '../services/legal';

function DraftBanner({ notice }: { notice: string | null }) {
  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 mb-4 text-[11px] font-black uppercase tracking-widest">
      {notice || 'DRAFT — requires attorney review before public launch.'}
    </div>
  );
}

function DocBody({ loaded, loading }: { loaded: LoadedLegalDoc | null; loading: boolean }) {
  if (loading) {
    return <p className="text-xs text-slate-400 italic py-6 text-center">Loading document…</p>;
  }
  if (!loaded) return null;
  return (
    <div>
      <DraftBanner notice={loaded.draftNotice} />
      <div
        className="legal-doc text-[13px] leading-relaxed text-slate-700 space-y-2 [&_h2]:text-base [&_h2]:font-black [&_h2]:text-slate-900 [&_h2]:mt-4 [&_h3]:text-sm [&_h3]:font-black [&_h3]:text-slate-900 [&_h3]:mt-3 [&_h4]:text-[13px] [&_h4]:font-black [&_h4]:text-slate-900 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_strong]:font-black"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(loaded.body) }}
      />
    </div>
  );
}

export function LegalDocsViewer({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<LegalDoc['id']>('tos');
  const [loaded, setLoaded] = useState<Record<string, LoadedLegalDoc>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const results = await Promise.all(LEGAL_DOCS.map(loadLegalDoc));
      if (cancelled) return;
      const map: Record<string, LoadedLegalDoc> = {};
      results.forEach((r) => { map[r.doc.id] = r; });
      setLoaded(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const active = LEGAL_DOCS.find((d) => d.id === tab)!;

  return (
    <div className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-md flex items-end md:items-center justify-center p-0 md:p-6 animate-fade-in">
      <div className="bg-white w-full max-w-2xl rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-slide-up">
        <div className="p-6 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-[#003366] rounded-xl"><FileText size={20} /></div>
            <h3 className="text-lg font-black text-slate-900 tracking-tighter uppercase">Legal Documents</h3>
          </div>
          <button onClick={onClose} className="p-3 bg-slate-900 text-white rounded-xl hover:bg-black"><X size={18} /></button>
        </div>
        <div className="px-6 pt-4 flex gap-2 shrink-0 overflow-x-auto">
          {LEGAL_DOCS.map((d) => (
            <button
              key={d.id}
              onClick={() => setTab(d.id)}
              className={`px-4 py-2 rounded-full text-[10px] font-black uppercase whitespace-nowrap transition-all ${tab === d.id ? 'bg-[#003366] text-white shadow-md' : 'bg-slate-100 text-slate-400'}`}
            >
              {d.title}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          <DocBody loaded={loaded[active.id] || null} loading={loading} />
        </div>
      </div>
    </div>
  );
}

export default function LegalConsentGate({ onAccepted }: { onAccepted: () => void }) {
  const [checks, setChecks] = useState<Record<LegalDoc['id'], boolean>>({
    tos: false, privacy: false, guidelines: false,
  });
  const [expanded, setExpanded] = useState<LegalDoc['id'] | null>(null);
  const [loaded, setLoaded] = useState<Record<string, LoadedLegalDoc>>({});
  const [loadingDocs, setLoadingDocs] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingDocs(true);
    (async () => {
      const results = await Promise.all(LEGAL_DOCS.map(loadLegalDoc));
      if (cancelled) return;
      const map: Record<string, LoadedLegalDoc> = {};
      results.forEach((r) => { map[r.doc.id] = r; });
      setLoaded(map);
      setLoadingDocs(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const allChecked = LEGAL_DOCS.every((d) => checks[d.id]);

  const handleAccept = () => {
    if (!allChecked) return;
    recordLegalAcceptance();
    onAccepted();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
      <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 md:p-10 animate-slide-up max-h-[92vh] overflow-y-auto custom-scrollbar">
        <div className="w-16 h-16 bg-[#003366] text-white rounded-3xl flex items-center justify-center mx-auto mb-6">
          <ShieldCheck size={32} />
        </div>
        <h2 className="text-2xl font-black text-slate-900 tracking-tighter text-center mb-2 uppercase">Before you start</h2>
        <p className="text-slate-400 font-medium text-sm text-center mb-8">
          Please review and accept our legal documents to use C-Shopper. You must be 13 or older.
        </p>

        <div className="space-y-3 mb-8">
          {LEGAL_DOCS.map((d) => (
            <div key={d.id} className={`border rounded-2xl overflow-hidden transition-all ${checks[d.id] ? 'border-green-200 bg-green-50/40' : 'border-slate-100'}`}>
              <div className="flex items-center gap-3 p-4">
                <button
                  onClick={() => setChecks((c) => ({ ...c, [d.id]: !c[d.id] }))}
                  aria-label={`Accept ${d.title}`}
                  className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${checks[d.id] ? 'bg-green-500 border-green-500 text-white' : 'border-slate-200 text-transparent'}`}
                >
                  <CheckCircle2 size={18} />
                </button>
                <button
                  onClick={() => setExpanded((e) => (e === d.id ? null : d.id))}
                  className="flex-1 text-left flex items-center justify-between gap-2"
                >
                  <span className="text-sm font-black text-slate-800 uppercase">{d.title}</span>
                  <ChevronDown size={16} className={`text-slate-300 transition-transform ${expanded === d.id ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {expanded === d.id && (
                <div className="px-4 pb-4">
                  <div className="bg-slate-50 rounded-xl p-4 max-h-64 overflow-y-auto custom-scrollbar border border-slate-100">
                    <DocBody loaded={loaded[d.id] || null} loading={loadingDocs} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={handleAccept}
          disabled={!allChecked}
          className="w-full py-4 bg-[#E31837] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl disabled:opacity-40 active:scale-95 transition-all"
        >
          Accept & Continue
        </button>
        <p className="mt-4 text-center text-[10px] font-bold text-slate-300 uppercase tracking-widest">
          You can re-read these anytime in Profile → Legal
        </p>
      </div>
    </div>
  );
}
