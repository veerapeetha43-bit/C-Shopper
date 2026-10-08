/**
 * ShareConsentModal — public-share consent for scanned receipt items.
 *
 * Lists EXACTLY which items + prices will be shared publicly, with per-item
 * toggle switches and a confirm button. The items passed in are ALREADY
 * PII-stripped on-device (see services/moderation.ts stripReceiptPII) — raw
 * receipt text/images are NEVER uploaded to any public surface.
 */
import React from 'react';
import { X, Share2, Check } from 'lucide-react';
import type { ReceiptItem } from '../types';

interface Props {
  items: ReceiptItem[];
  toggles: Record<string, boolean>;
  onToggle: (itemId: string) => void;
  onConfirm: () => void;
  onSkip: () => void;
}

export default function ShareConsentModal({ items, toggles, onToggle, onConfirm, onSkip }: Props) {
  const selected = items.filter((i) => toggles[i.id] !== false);
  const total = selected.reduce((a, b) => a + b.price, 0);

  return (
    <div className="fixed inset-0 z-[155] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-slide-up">
        <div className="p-6 border-b shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-green-50 text-green-600 rounded-xl"><Share2 size={20} /></div>
              <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase">Share publicly?</h3>
            </div>
            <button onClick={onSkip} className="p-2 bg-slate-50 rounded-full text-slate-400"><X size={18} /></button>
          </div>
          <p className="text-xs text-slate-400 font-medium">
            Share these <strong className="text-slate-700">{selected.length} items</strong> publicly to the community price database?
            Toggle off anything you want to keep private. Sensitive data (card numbers, auth codes, member IDs) was already stripped on your device.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {items.map((item) => {
            const on = toggles[item.id] !== false;
            return (
              <div key={item.id} className={`flex items-center justify-between gap-3 p-3 rounded-2xl border transition-all ${on ? 'bg-white border-slate-100' : 'bg-slate-50 border-transparent opacity-50'}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black truncate uppercase">{item.name}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">ID #{item.itemNumber} • ${item.price.toFixed(2)}</p>
                </div>
                <button
                  onClick={() => onToggle(item.id)}
                  aria-label={`Toggle ${item.name}`}
                  className={`w-12 h-7 rounded-full p-1 transition-colors shrink-0 ${on ? 'bg-green-500' : 'bg-slate-200'}`}
                >
                  <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''} flex items-center justify-center`}>
                    {on && <Check size={12} className="text-green-600" strokeWidth={4} />}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="p-6 border-t shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{selected.length} items selected</span>
            <span className="text-lg font-black text-[#003366]">${total.toFixed(2)}</span>
          </div>
          <button
            onClick={onConfirm}
            disabled={selected.length === 0}
            className="w-full py-4 bg-[#E31837] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl disabled:opacity-40 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <Share2 size={16} /> Share {selected.length} items publicly
          </button>
          <button onClick={onSkip} className="w-full text-[10px] font-black uppercase text-slate-300 tracking-widest">Skip — keep private</button>
        </div>
      </div>
    </div>
  );
}
