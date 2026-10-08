/**
 * CreateGroupModal — name, description, public/private toggle, and optional
 * store scope. Public groups can be scoped to the user's current Costco
 * (store-specific hub) or left general for all Costcos.
 * New groups reuse the existing join + chat flows (handleJoinGroup /
 * handleSendComment in App.tsx), so they behave exactly like seeded groups.
 */
import React, { useState } from 'react';
import { X, Users, Globe, Lock, MapPin } from 'lucide-react';

interface Props {
  onClose: () => void;
  onCreate: (name: string, description: string, isPublic: boolean, storeId: string | null) => void;
  /** Current store context for store-scoped public groups (null = none chosen). */
  storeId?: string | null;
  storeName?: string | null;
}

export default function CreateGroupModal({ onClose, onCreate, storeId, storeName }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [storeScoped, setStoreScoped] = useState(true);

  const canCreate = name.trim().length >= 3;
  const effectiveStoreId = isPublic && storeScoped && storeId ? storeId : null;

  return (
    <div className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-md flex items-end md:items-center justify-center p-0 md:p-6 animate-fade-in">
      <div className="bg-white w-full max-w-md rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl p-8 animate-slide-up">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-[#003366] rounded-xl"><Users size={20} /></div>
            <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase">Create Group</h3>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-50 rounded-full text-slate-400"><X size={18} /></button>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="text-[9px] font-black uppercase text-slate-400 ml-1 tracking-widest">Group name</label>
            <input
              type="text"
              placeholder="e.g. Kirkland Diehards"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="mt-1 w-full px-4 py-3.5 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none focus:ring-2 ring-[#003366]/20"
            />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase text-slate-400 ml-1 tracking-widest">Description</label>
            <textarea
              placeholder="What is this hub about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={280}
              rows={3}
              className="mt-1 w-full px-4 py-3.5 bg-slate-50 border border-slate-100 rounded-xl font-medium text-sm outline-none h-24 focus:ring-2 ring-[#003366]/20"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsPublic(true)}
              className={`flex-1 p-4 rounded-2xl border text-left flex items-center gap-3 transition-all ${isPublic ? 'bg-blue-50 border-blue-200' : 'hover:bg-slate-50'}`}
            >
              <Globe size={18} className={isPublic ? 'text-blue-600' : 'text-slate-300'} />
              <div>
                <p className="text-xs font-black uppercase">Public</p>
                <p className="text-[10px] text-slate-400 font-medium">Anyone can find & join</p>
              </div>
            </button>
            <button
              onClick={() => setIsPublic(false)}
              className={`flex-1 p-4 rounded-2xl border text-left flex items-center gap-3 transition-all ${!isPublic ? 'bg-blue-50 border-blue-200' : 'hover:bg-slate-50'}`}
            >
              <Lock size={18} className={!isPublic ? 'text-blue-600' : 'text-slate-300'} />
              <div>
                <p className="text-xs font-black uppercase">Private</p>
                <p className="text-[10px] text-slate-400 font-medium">Family-style, by invite</p>
              </div>
            </button>
          </div>
          {isPublic && storeId && (
            <div>
              <label className="text-[9px] font-black uppercase text-slate-400 ml-1 tracking-widest">Who is this hub for?</label>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setStoreScoped(true)}
                  className={`flex-1 p-4 rounded-2xl border text-left flex items-center gap-3 transition-all ${storeScoped ? 'bg-amber-50 border-amber-200' : 'hover:bg-slate-50'}`}
                >
                  <MapPin size={18} className={storeScoped ? 'text-amber-600' : 'text-slate-300'} />
                  <div>
                    <p className="text-xs font-black uppercase">This Costco only</p>
                    <p className="text-[10px] text-slate-400 font-medium truncate max-w-[140px]">{storeName || 'Your store'}</p>
                  </div>
                </button>
                <button
                  onClick={() => setStoreScoped(false)}
                  className={`flex-1 p-4 rounded-2xl border text-left flex items-center gap-3 transition-all ${!storeScoped ? 'bg-blue-50 border-blue-200' : 'hover:bg-slate-50'}`}
                >
                  <Globe size={18} className={!storeScoped ? 'text-blue-600' : 'text-slate-300'} />
                  <div>
                    <p className="text-xs font-black uppercase">All Costcos</p>
                    <p className="text-[10px] text-slate-400 font-medium">General hub</p>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => canCreate && onCreate(name.trim(), description.trim(), isPublic, effectiveStoreId)}
          disabled={!canCreate}
          className="w-full py-4 bg-[#E31837] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl disabled:opacity-40 active:scale-95 transition-all"
        >
          Create Group
        </button>
      </div>
    </div>
  );
}
