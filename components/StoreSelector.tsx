/**
 * StoreSelector — pick your Costco: GPS "Near me", ZIP code, or text search.
 * Each row shows distance (when a location is known) and a "Set as home
 * Costco" star. Home persists to the profile (localStorage + Supabase).
 */
import React, { useMemo, useState } from 'react';
import { X, MapPin, Navigation, Search, Star, CheckCircle2, Loader2, Home } from 'lucide-react';
import type { Store } from '../types';
import {
  getDeviceLocation,
  zipToCoords,
  nearestStores,
  getCachedLocation,
  isValidZip,
  type LocatedStore,
} from '../services/location';
import { shortStoreName } from '../services/storeData';

interface Props {
  stores: Store[];
  selectedStoreId: string | null;
  homeStoreId: string | null;
  onSelect: (id: string) => void;
  onSetHome: (id: string) => void;
  onClose: () => void;
}

type Mode = 'gps' | 'zip' | 'search';

export default function StoreSelector({ stores, selectedStoreId, homeStoreId, onSelect, onSetHome, onClose }: Props) {
  const [mode, setMode] = useState<Mode>(() => (getCachedLocation() ? 'gps' : 'zip'));
  const [zip, setZip] = useState(() => getCachedLocation()?.zip || '');
  const [query, setQuery] = useState('');
  const [located, setLocated] = useState<LocatedStore[] | null>(() => {
    const c = getCachedLocation();
    return c ? nearestStores(stores, c, 12) : null;
  });
  const [placeLabel, setPlaceLabel] = useState<string | null>(() => getCachedLocation()?.place || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGps = async () => {
    setBusy(true);
    setError(null);
    try {
      const loc = await getDeviceLocation();
      setLocated(nearestStores(stores, loc, 12));
      setPlaceLabel('Your current location');
      setMode('gps');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get your location.');
    } finally {
      setBusy(false);
    }
  };

  const handleZip = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await zipToCoords(zip);
      setLocated(nearestStores(stores, r, 12));
      setPlaceLabel(r.place);
      setMode('zip');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ZIP lookup failed.');
    } finally {
      setBusy(false);
    }
  };

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return stores
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.city?.toLowerCase().includes(q) ||
          s.zipCode.startsWith(q) ||
          `${s.city}, ${s.state}`.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [query, stores]);

  const showingLocated = mode !== 'search' && located;
  const list: (Store & { distanceMi?: number })[] = showingLocated ? located! : searchResults;

  const pick = (id: string) => {
    onSelect(id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-6 animate-fade-in">
      <div className="bg-white w-full max-w-lg rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl p-6 md:p-8 animate-slide-up overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase">Choose your Costco</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              Deals, groups & prices follow this store
            </p>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-50 rounded-full text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="grid grid-cols-3 gap-2 mb-4 shrink-0">
          <button
            onClick={() => { setMode('gps'); if (!located) handleGps(); }}
            className={`py-3 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all ${mode === 'gps' ? 'bg-[#003366] text-white shadow-md' : 'bg-slate-50 text-slate-500'}`}
          >
            <Navigation size={13} /> Near me
          </button>
          <button
            onClick={() => setMode('zip')}
            className={`py-3 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all ${mode === 'zip' ? 'bg-[#003366] text-white shadow-md' : 'bg-slate-50 text-slate-500'}`}
          >
            <MapPin size={13} /> ZIP code
          </button>
          <button
            onClick={() => setMode('search')}
            className={`py-3 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all ${mode === 'search' ? 'bg-[#003366] text-white shadow-md' : 'bg-slate-50 text-slate-500'}`}
          >
            <Search size={13} /> Search
          </button>
        </div>

        {mode === 'zip' && (
          <div className="flex gap-2 mb-4 shrink-0">
            <input
              type="text"
              inputMode="numeric"
              placeholder="Enter ZIP code"
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
              onKeyDown={(e) => e.key === 'Enter' && handleZip()}
              className="flex-1 px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none focus:ring-2 ring-[#003366]/20"
            />
            <button
              onClick={handleZip}
              disabled={busy || !isValidZip(zip)}
              className="px-5 py-3 bg-[#E31837] text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg disabled:opacity-40 flex items-center gap-2"
            >
              {busy && <Loader2 size={13} className="animate-spin" />} Find
            </button>
          </div>
        )}

        {mode === 'gps' && !located && (
          <button
            onClick={handleGps}
            disabled={busy}
            className="w-full mb-4 py-4 bg-[#E31837] text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Navigation size={16} />}
            {busy ? 'Locating…' : 'Use my location'}
          </button>
        )}

        {mode === 'search' && (
          <div className="relative mb-4 shrink-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
            <input
              type="text"
              placeholder="City, store name, or ZIP…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none focus:ring-2 ring-[#003366]/20"
            />
          </div>
        )}

        {error && (
          <p className="mb-3 text-[11px] font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 shrink-0">{error}</p>
        )}

        {placeLabel && showingLocated && (
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">
            Nearest to {placeLabel} • {located!.length} stores
          </p>
        )}

        <div className="space-y-1.5 overflow-y-auto pr-1 custom-scrollbar flex-1">
          {busy && !showingLocated && mode !== 'zip' && (
            <div className="py-10 flex flex-col items-center gap-3 text-slate-300">
              <Loader2 size={28} className="animate-spin" />
              <p className="text-[10px] font-black uppercase tracking-widest">Finding nearby Costcos…</p>
            </div>
          )}
          {list.map((s) => {
            const isSelected = s.id === selectedStoreId;
            const isHome = s.id === homeStoreId;
            return (
              <div
                key={s.id}
                className={`w-full text-left p-3.5 rounded-xl border transition-all ${isSelected ? 'bg-blue-50 border-blue-200' : 'hover:bg-slate-50 border-transparent'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => pick(s.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <p className="font-black text-slate-900 text-sm truncate uppercase">{shortStoreName(s)}</p>
                      {isHome && (
                        <span className="shrink-0 flex items-center gap-1 text-[8px] font-black uppercase bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                          <Home size={8} /> Home
                        </span>
                      )}
                      {isSelected && <CheckCircle2 size={12} className="text-blue-600 shrink-0" />}
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight truncate">
                      {s.address}
                      {s.phone ? ` • ${s.phone}` : ''}
                    </p>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {typeof s.distanceMi === 'number' && (
                      <span className="text-[10px] font-black text-slate-500">{s.distanceMi}mi</span>
                    )}
                    <button
                      onClick={() => { onSetHome(s.id); onClose(); }}
                      aria-label={isHome ? 'Home Costco' : 'Set as home Costco'}
                      title={isHome ? 'Your home Costco' : 'Set as home Costco'}
                      className={`p-2 rounded-lg transition-all ${isHome ? 'text-amber-500 bg-amber-50' : 'text-slate-300 hover:text-amber-400 hover:bg-amber-50'}`}
                    >
                      <Star size={16} fill={isHome ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {!busy && list.length === 0 && (
            <p className="text-center py-8 text-xs font-bold text-slate-400 italic">
              {mode === 'search'
                ? query.trim()
                  ? `No Costcos match "${query}"`
                  : 'Type a city, store name, or ZIP to search all 605 US warehouses.'
                : 'Tap "Use my location" or enter a ZIP code to find nearby Costcos.'}
            </p>
          )}
        </div>

        <p className="mt-3 text-center text-[9px] font-bold text-slate-300 uppercase tracking-widest shrink-0">
          {stores.length} US warehouses • tap ★ to set your home Costco
        </p>
      </div>
    </div>
  );
}
