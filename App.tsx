import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Search, Receipt, MapPin, TrendingDown, BarChart3, CreditCard, User, Plus, Bell, X,
  CheckCircle2, AlertTriangle, ChevronRight, MessageSquare, Send, Users, Info, Tag,
  PackageCheck, Star, ImageIcon, ThumbsUp, ThumbsDown, ShoppingCart, Check,
  Minus, Maximize2, Minimize2, SearchCode, Settings, LogOut, ShieldCheck, Mail, Phone,
  CreditCard as CreditCardIcon, Landmark, KeyRound, UserCircle, BellRing, Smartphone,
  CreditCard as CardIcon, Vote, Lock, Eye, EyeOff, UserPlus, ShoppingBasket,
  Trash2, Heart, Map as MapIcon, ChevronDown, Sparkles, Navigation, ArrowUpRight,
  TrendingUp, Zap, Clock, Calendar, ShieldAlert, Wallet, CreditCard as Card,
  MessageCircle, PlusCircle, Filter, Search as SearchIcon, MoreHorizontal, UserCheck,
  Eraser, Sparkle, Fuel, History, Info as InfoIcon, ArrowDownRight,
  LayoutGrid, ListFilter, ArrowLeft, Camera, Smile, Globe, LocateFixed, Share2, Target,
  CalendarDays, Gift
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import {
  isCloudEnabled, fetchCloudNotifications, markCloudNotificationRead,
  syncUpToCloud, flushFeedbackOutbox, fetchHomeStoreId, saveHomeStoreId,
  fetchPriceHistory, fetchStoreCatalog, fetchPublicGroups, fetchGroupComments,
  detectDealSignals, fetchDeals, publishDealAlerts, signalDirection, isClearancePrice,
  PriceHistoryPoint, CloudGroup, CloudGroupComment, DealSignal,
  CloudNotification,
} from './services/cloud';
import { getCachedLocation, getDeviceLocation, zipToCoords, haversineMiles, nearestStores, isValidZip } from './services/location';
import { loadStores, shortStoreName } from './services/storeData';
import { buildSeedCatalog, SEED_MARKER_KEY } from './services/seed';
import { checkMessageSafety, stripReceiptPII, MODERATION_WARNING } from './services/moderation';
import { scanReceiptViaWorker, scanReceipt, hasApiKey } from './services/gemini';
import { getSession, signIn, signOut, onAuthChange } from './services/auth';
import { reconcileGroups } from './services/groupSync';
import type {
  Store, ReceiptItem, GlobalPriceEntry, CommunityGroup, GroupComment,
  ItemReview, AppNotification, UserSubscription,
} from './types';
import StoreSelector from './components/StoreSelector';
import ReceiptScanner from './components/ReceiptScanner';
import LegalConsentGate from './components/LegalConsentGate';
import LoginScreen from './components/LoginScreen';
import CreateGroupModal from './components/CreateGroupModal';
import ShareConsentModal from './components/ShareConsentModal';
import ModerationView from './components/ModerationView';
import FeedbackForm from './components/FeedbackForm';

// --- Launch flags ------------------------------------------------------------
const FREE_LAUNCH = true;

const CATEGORIES = ["All", "Pantry", "Electronics", "Frozen", "Household", "Fresh", "Snacks", "Beverages"];

const DEFAULT_GROUPS: CommunityGroup[] = [
  { id: 'g1', name: 'Organic Finders', description: 'Discuss organic item prices and quality.', creatorId: 'admin', members: ['me', 'u1'], pendingRequests: [], isPublic: true, keywords: ['organic', 'healthy', 'fresh'] },
  { id: 'g2', name: 'Tech Deals', description: 'Electronics price drops and reviews.', creatorId: 'u2', members: ['u2'], pendingRequests: [], isPublic: true, keywords: ['tech', 'tv', 'laptop'] },
];

const EMOJI_LIST = ["😂", "🤣", "🤪", "😎", "😏", "🙌", "💯", "🛒", "🥓", "🌭", "🍕", "🤑", "💸", "👀", "🔥", "🤩", "🤯", "🍗", "🥑", "🥦", "🤡", "🥴", "🤤"];

const DEFAULT_AVATAR =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="20" fill="#003366"/><text x="50" y="62" font-family="sans-serif" font-size="38" font-weight="900" fill="#ffffff" text-anchor="middle">CS</text></svg>',
  );

/** Safe localStorage read with corruption recovery. */
const loadJSON = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    console.warn(`Corrupted localStorage key "${key}" — resetting to default.`);
    try { localStorage.removeItem(key); } catch { /* noop */ }
    return fallback;
  }
};

// --- Session helpers (local name+email auth; Supabase Auth is a roadmap item)
const LEGAL_KEY = 'ws_legal_consent';

function loadLegalConsent() {
  try {
    const raw = localStorage.getItem(LEGAL_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return !data || typeof data.acceptedAt !== 'string' || !data.versions ? null : data;
  } catch {
    try { localStorage.removeItem(LEGAL_KEY); } catch { /* noop */ }
    return null;
  }
}

export default function App() {
  // --- Legal gate & auth ---
  const [isLegalAccepted, setIsLegalAccepted] = useState(() => loadLegalConsent() !== null);
  const [session, setSession] = useState(() => getSession());
  const [isLoggedIn, setIsLoggedIn] = useState(() => getSession() !== null);

  // --- Navigation ---
  const [activeTab, setActiveTab] = useState<'dashboard' | 'stores' | 'tracker' | 'pricing' | 'upload' | 'community' | 'profile' | 'favorites' | 'deals' | 'history'>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');

  // --- Data (localStorage-backed, cloud-synced) ---
  const [receipts, setReceipts] = useState<ReceiptItem[]>(() => loadJSON<ReceiptItem[]>('ws_receipts', []));
  const [globalPrices, setGlobalPrices] = useState<GlobalPriceEntry[]>(() => {
    const existing = loadJSON<GlobalPriceEntry[]>('ws_global_prices', []);
    const legacyIds = new Set(['1', '2', '3']);
    const selected = localStorage.getItem('ws_selected_store');
    if (existing.length > 0) {
      // One-time remap: placeholder warehouse ids -> the user's selected store.
      if (selected && existing.some((p) => legacyIds.has(p.warehouseId))) {
        const remapped = existing.map((p) =>
          legacyIds.has(p.warehouseId) ? { ...p, warehouseId: selected } : p,
        );
        try { localStorage.setItem('ws_global_prices', JSON.stringify(remapped)); } catch { /* noop */ }
        return remapped;
      }
      return existing;
    }
    return [];
  });
  const [favorites, setFavorites] = useState<string[]>(() => loadJSON<string[]>('ws_favorites', []));
  const [sharedFamilyItems, setSharedFamilyItems] = useState<string[]>(() => loadJSON<string[]>('ws_shared_family', []));
  const [shareOutbox, setShareOutbox] = useState<any[]>(() => loadJSON<any[]>('ws_share_outbox', []));
  const [mutedUsers, setMutedUsers] = useState<Record<string, boolean>>(() => loadJSON('ws_muted_users', {}));
  const [subscription, setSubscription] = useState<UserSubscription>(() => {
    const saved = loadJSON<UserSubscription | null>('ws_sub', null);
    return saved || {
      type: 'platinum', isTrial: true, trialStartDate: new Date().toISOString(),
      receiptsCount: 0, members: [], status: 'trial',
    } as UserSubscription;
  });
  const [groups, setGroups] = useState<CommunityGroup[]>(() => loadJSON<CommunityGroup[]>('ws_groups', DEFAULT_GROUPS));
  const [groupComments, setGroupComments] = useState<GroupComment[]>(() => loadJSON<GroupComment[]>('ws_group_comments', []));
  const [itemReviews, setItemReviews] = useState<ItemReview[]>(() => loadJSON<ItemReview[]>('ws_item_reviews', []));

  // --- UI state ---
  const [activeItemDetail, setActiveItemDetail] = useState<string | null>(null);
  const [cloudAlerts, setCloudAlerts] = useState<CloudNotification[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [storesReady, setStoresReady] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(() => localStorage.getItem('ws_selected_store'));
  const [homeStoreId, setHomeStoreId] = useState<string | null>(() => localStorage.getItem('ws_home_store'));
  const [communityCatalogReady, setCommunityCatalogReady] = useState(false);
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(() => !localStorage.getItem('ws_selected_store') && !localStorage.getItem('ws_home_store'));
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
  const [isShareConsentOpen, setIsShareConsentOpen] = useState(false);
  const [shareToggles, setShareToggles] = useState<Record<string, boolean>>({});
  const [isModerationOpen, setIsModerationOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isLegalViewerOpen, setIsLegalViewerOpen] = useState(false);
  const [lastScannedItems, setLastScannedItems] = useState<ReceiptItem[]>([]);
  const [isScanResultModalOpen, setIsScanResultModalOpen] = useState(false);
  const [isFamilySharePromptOpen, setIsFamilySharePromptOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryPoint[]>([]);
  const [isBillingModalOpen, setIsBillingModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [deals, setDeals] = useState<DealSignal[]>([]);

  const syncTimer = useRef<number | null>(null);
  const lastCommunitySync = useRef(0);
  const reconciledGroupIds = useRef<Set<string> | null>(null);
  const lastDealsSync = useRef(0);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const trialDaysLeft = useMemo(() => {
    const start = new Date(subscription.trialStartDate).getTime();
    const now = Date.now();
    const days = Math.ceil((start + 30 * 24 * 60 * 60 * 1000 - now) / (1000 * 60 * 60 * 24));
    return Math.max(0, days);
  }, [subscription.trialStartDate]);
  const isExpired = false; // FREE_LAUNCH: never expires

  const currentStore = stores.find((s) => s.id === selectedStoreId);
  const homeStore = stores.find((s) => s.id === homeStoreId);

  // --- Legal gate listener ---
  useEffect(() => {
    const onAccept = () => setIsLegalAccepted(true);
    window.addEventListener('legal-accepted', onAccept);
    return () => window.removeEventListener('legal-accepted', onAccept);
  }, []);

  // --- Automated error telemetry (feeds ops dashboard + self-heal loop) ---
  useEffect(() => {
    const seen = new Map<string, number>();
    const report = (message: string, stack?: string) => {
      if (!message || /ResizeObserver|Script error/i.test(message)) return;
      const now = Date.now();
      const last = seen.get(message) || 0;
      if (now - last < 60000) return; // max 1 report per message per minute
      seen.set(message, now);
      try {
        const email = getSession()?.email || null;
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/app_errors`, {
          method: 'POST',
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            message: message.slice(0, 500),
            stack: (stack || '').slice(0, 2000),
            url: window.location.href.slice(0, 300),
            user_agent: navigator.userAgent.slice(0, 300),
            app_version: 'stable',
            user_email: email,
          }),
        }).catch(() => {});
      } catch { /* never break the app for telemetry */ }
    };
    const onError = (e: ErrorEvent) => report(e.message || 'Unknown error', e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => report('Unhandled rejection: ' + (e.reason?.message || String(e.reason)), e.reason?.stack);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // --- Auth state subscription ---
  useEffect(() => {
    return onAuthChange((s) => {
      setSession(s);
      setIsLoggedIn(s !== null);
    });
  }, []);

  // --- Persist everything to localStorage ---
  useEffect(() => {
    try {
      localStorage.setItem('ws_receipts', JSON.stringify(receipts));
      localStorage.setItem('ws_global_prices', JSON.stringify(globalPrices));
      localStorage.setItem('ws_favorites', JSON.stringify(favorites));
      localStorage.setItem('ws_shared_family', JSON.stringify(sharedFamilyItems));
      localStorage.setItem('ws_sub', JSON.stringify(subscription));
      localStorage.setItem('ws_groups', JSON.stringify(groups));
      localStorage.setItem('ws_group_comments', JSON.stringify(groupComments));
      localStorage.setItem('ws_item_reviews', JSON.stringify(itemReviews));
      localStorage.setItem('ws_share_outbox', JSON.stringify(shareOutbox));
      localStorage.setItem('ws_muted_users', JSON.stringify(mutedUsers));
      localStorage.setItem('ws_logged_in', isLoggedIn.toString());
      if (selectedStoreId) localStorage.setItem('ws_selected_store', selectedStoreId);
      if (homeStoreId) localStorage.setItem('ws_home_store', homeStoreId);
    } catch { /* noop */ }
  }, [receipts, globalPrices, favorites, sharedFamilyItems, subscription, groups, groupComments, itemReviews, shareOutbox, mutedUsers, isLoggedIn, selectedStoreId, homeStoreId]);

  // --- Load stores ---
  useEffect(() => {
    let cancelled = false;
    loadStores().then((s) => {
      if (!cancelled) { setStores(s); setStoresReady(true); }
    });
    return () => { cancelled = true; };
  }, []);

  // --- Cloud sync up (debounced) ---
  useEffect(() => {
    if (!isCloudEnabled()) return;
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      // Upload only groups created under the current login: this never
      // resurrects server-deleted ghosts and never clobbers server rows'
      // creator_id with this device's id. Server-origin copies ('cloud')
      // are already on the server; sync-down is their update path.
      const myEmail = getSession()?.email || '';
      syncUpToCloud({
        receipts, globalPrices, favorites,
        groups: groups.filter((g) =>
          g.creatorId === 'me' && (!g.creatorEmail || !myEmail || g.creatorEmail === myEmail)),
        groupComments, itemReviews,
        userName: 'Shopper',
      });
    }, 4000);
    return () => { if (syncTimer.current) window.clearTimeout(syncTimer.current); };
  }, [receipts, globalPrices, favorites, groups, groupComments, itemReviews]);

  // --- Community catalog pull (cross-device prices) ---
  useEffect(() => {
    if (!isCloudEnabled() || !selectedStoreId) {
      setCommunityCatalogReady(true);
      return;
    }
    let cancelled = false;
    setCommunityCatalogReady(false);
    fetchStoreCatalog(selectedStoreId).then((rows) => {
      if (cancelled) return;
      if (rows.length) {
        const zipCode = stores.find((s) => s.id === selectedStoreId)?.zipCode || '';
        setGlobalPrices((prev) => {
          const seen = new Set(prev.map((p) => `${p.itemNumber}|${p.warehouseId}`));
          const additions: GlobalPriceEntry[] = [];
          for (const r of rows) {
            const key = `${r.item_number}|${selectedStoreId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            additions.push({
              itemNumber: r.item_number,
              itemName: r.item_name || r.item_number,
              price: Number(r.price),
              unitPrice: r.unit_price != null ? Number(r.unit_price) : undefined,
              unit: r.unit || undefined,
              warehouseId: selectedStoreId,
              zipCode,
              updatedAt: r.observed_at,
              category: r.category || undefined,
            });
          }
          return additions.length ? [...prev, ...additions] : prev;
        });
      }
      setCommunityCatalogReady(true);
    }).catch(() => { if (!cancelled) setCommunityCatalogReady(true); });
    return () => { cancelled = true; };
  }, [selectedStoreId]);

  // --- Demo seed (last resort) ---
  useEffect(() => {
    if (!selectedStoreId || globalPrices.length > 0) return;
    if (localStorage.getItem(SEED_MARKER_KEY)) return;
    if (isCloudEnabled() && !communityCatalogReady) return;
    const store = stores.find((s) => s.id === selectedStoreId);
    const seeded = buildSeedCatalog(selectedStoreId, store?.zipCode || '');
    setGlobalPrices(seeded);
    try { localStorage.setItem(SEED_MARKER_KEY, 'true'); } catch { /* noop */ }
  }, [selectedStoreId, stores, globalPrices.length, communityCatalogReady]);

  // --- Home store: adopt cloud value when local is unset ---
  useEffect(() => {
    if (homeStoreId) return;
    fetchHomeStoreId().then((id) => {
      if (id) {
        setHomeStoreId(id);
        try { localStorage.setItem('ws_home_store', id); } catch { /* noop */ }
      }
    }).catch(() => {});
  }, []);

  // --- Group id migration (legacy 'g...' -> UUID) ---
  useEffect(() => {
    const uuidRe = /^[0-9a-f-]{36}$/i;
    const legacy = groups.filter((g) => !uuidRe.test(g.id));
    if (!legacy.length) return;
    const map = new Map(legacy.map((g) => [g.id, crypto.randomUUID()]));
    setGroups((prev) => prev.map((g) => (map.has(g.id) ? { ...g, id: map.get(g.id)! } : g)));
    setGroupComments((prev) => prev.map((c) => (map.has(c.groupId) ? { ...c, groupId: map.get(c.groupId)! } : c)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Community sync-down ---
  useEffect(() => {
    if (!isCloudEnabled()) return;
    if (activeTab !== 'community' && lastCommunitySync.current !== 0) return;
    if (Date.now() - lastCommunitySync.current < 120000) return;
    let cancelled = false;
    (async () => {
      const cloudGroups = await fetchPublicGroups();
      if (cancelled) return;
      if (cloudGroups.length) {
        setGroups((prev) => {
          const reconciled = reconcileGroups(prev, cloudGroups, (session as any)?.email || '');
          reconciledGroupIds.current = new Set(reconciled.map((g) => g.id));
          return reconciled;
        });
        const comments = await fetchGroupComments(cloudGroups.map((cg) => cg.id));
        if (cancelled) return;
        if (comments.length) {
          setGroupComments((prev) => {
            // Drop comments belonging to groups that no longer exist (pruned ghosts).
            const ids = reconciledGroupIds.current;
            const live = ids ? prev.filter((c) => ids.has(c.groupId)) : prev;
            const have = new Set(live.map((c) => c.id));
            const additions: GroupComment[] = [];
            for (const cc of comments) {
              if (have.has(cc.id)) continue;
              have.add(cc.id);
              additions.push({
                id: cc.id, groupId: cc.group_id, userId: cc.user_id,
                userName: cc.author_name || 'Shopper', userAvatar: DEFAULT_AVATAR,
                text: cc.text, itemNumber: cc.item_number || undefined,
                timestamp: cc.created_at || new Date().toISOString(),
                imageUrl: cc.image_url || undefined,
              });
            }
            const prunedCount = prev.length - live.length;
            if (!additions.length && !prunedCount) return prev;
            return [...live, ...additions];
          });
        }
      }
      if (!cancelled) lastCommunitySync.current = Date.now();
    })();
    return () => { cancelled = true; };
  }, [activeTab]);

  // --- Deals feed ---
  useEffect(() => {
    if (!isCloudEnabled()) return;
    if (activeTab !== 'deals' && lastDealsSync.current !== 0) return;
    if (Date.now() - lastDealsSync.current < 120000) return;
    let cancelled = false;
    fetchDeals().then((d) => {
      if (cancelled) return;
      setDeals(d);
      lastDealsSync.current = Date.now();
    });
    return () => { cancelled = true; };
  }, [activeTab]);

  // --- Cloud notifications ---
  useEffect(() => {
    if (!isCloudEnabled()) return;
    fetchCloudNotifications().then(setCloudAlerts).catch(() => {});
  }, [isLoggedIn]);

  // --- Notifications (toasts) ---
  const addNotification = (msg: string, type: 'success' | 'alert' | 'info' = 'info') => {
    const id = Date.now().toString();
    setNotifications((prev) => [...prev, { id, msg, type } as AppNotification]);
    setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 6000);
  };

  const exportReceiptsCSV = () => {
    const header = 'item_number,name,price,category,purchase_date';
    const rows = receipts.map((r) =>
      [r.itemNumber, `"${(r.name || '').replace(/"/g, '""')}"`, r.price, r.category || '', r.purchaseDate || ''].join(','),
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `c-shopper-receipts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addNotification('Receipt history exported as CSV.', 'success');
  };

  const handleSelectStore = (id: string) => {
    setSelectedStoreId(id);
    const s = stores.find((x) => x.id === id);
    if (s) addNotification(`${shortStoreName(s)} selected — deals & groups rescoped.`, 'success');
  };

  const handleSetHomeStore = (id: string) => {
    setHomeStoreId(id);
    setSelectedStoreId(id);
    try { localStorage.setItem('ws_home_store', id); } catch { /* noop */ }
    saveHomeStoreId(id).catch(() => {});
    const s = stores.find((x) => x.id === id);
    addNotification(`${s ? shortStoreName(s) : 'Store'} set as your home Costco.`, 'success');
  };

  const handleLogout = () => {
    signOut();
    setSession(null);
    setIsLoggedIn(false);
    setActiveTab('dashboard');
  };

  // --- Receipt scanning ---
  const handleScan = async (base64: string) => {
    if (!base64) return;
    setIsScanning(true);
    try {
      let result;
      try {
        result = await scanReceiptViaWorker(base64);
      } catch {
        if (hasApiKey()) result = await scanReceipt(base64);
        else throw new Error('RECEIPT_SERVICE_UNREACHABLE');
      }
      const items: ReceiptItem[] = result.items.map((it) => ({
        id: Math.random().toString(36).substr(2, 9),
        itemNumber: it.itemNumber,
        name: it.name,
        price: it.price,
        category: it.category,
        purchaseDate: result.purchaseDate,
        warehouseId: selectedStoreId || undefined,
      }));
      const clean = stripReceiptPII(items);
      setReceipts((prev) => [...prev, ...clean]);
      setLastScannedItems(clean);
      setIsScanResultModalOpen(true);
      addNotification(`Receipt scanned: ${clean.length} items found.`, 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('RECEIPT_SERVICE_UNREACHABLE') || msg.includes('MISSING_GEMINI_API_KEY')) {
        addNotification('Receipt reading is connecting — please try again in a moment.', 'alert');
      } else {
        addNotification('Scan failed. Try a clearer photo.', 'alert');
        console.warn('Receipt scan error:', msg);
      }
    } finally {
      setIsScanning(false);
    }
  };

  // --- Share flow ---
  const afterScanAddAll = () => {
    let items = lastScannedItems;
    if (selectedCategory === '10') items = items.filter((i) => i.price >= 10);
    else if (selectedCategory === '20') items = items.filter((i) => i.price >= 20);
    const numbers = items.map((i) => i.itemNumber);
    setFavorites((prev) => Array.from(new Set([...prev, ...numbers])));
    setIsScanResultModalOpen(false);
    const toggles: Record<string, boolean> = {};
    lastScannedItems.forEach((i) => { toggles[i.id] = true; });
    setShareToggles(toggles);
    setIsShareConsentOpen(true);
  };

  const afterShareStep = () => {
    setIsShareConsentOpen(false);
    if (FREE_LAUNCH) setIsFamilySharePromptOpen(true);
    else { setActiveTab('favorites'); addNotification('Items added to your Watchlist.', 'success'); }
  };

  const confirmSharePublic = async () => {
    const chosen = lastScannedItems.filter((i) => shareToggles[i.id] !== false);
    if (chosen.length === 0) { afterShareStep(); return; }

    const entry = {
      id: 'so' + Date.now(),
      sharedAt: new Date().toISOString(),
      items: chosen.map((i) => ({
        itemNumber: i.itemNumber, name: i.name, price: i.price,
        category: i.category, purchaseDate: i.purchaseDate,
      })),
    };
    setShareOutbox((prev) => [...prev, entry]);

    // Merge into the community catalog under the active store.
    const storeId = selectedStoreId || homeStoreId || '';
    const zipCode = stores.find((s) => s.id === storeId)?.zipCode || '';
    if (storeId) {
      const now = new Date().toISOString();
      setGlobalPrices((prev) => {
        const seen = new Set(prev.map((p) => `${p.itemNumber}|${p.warehouseId}`));
        const additions: GlobalPriceEntry[] = [];
        for (const it of chosen) {
          const key = `${it.itemNumber}|${storeId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          additions.push({
            itemNumber: it.itemNumber, itemName: it.name, price: it.price,
            warehouseId: storeId, zipCode, updatedAt: now, category: it.category,
          });
        }
        return additions.length ? [...prev, ...additions] : prev;
      });
    }

    // Deal + clearance detection from the shared prices.
    let signals: DealSignal[] = [];
    try {
      signals = await detectDealSignals(
        chosen.map((i) => ({ itemNumber: i.itemNumber, name: i.name, price: i.price })),
        storeId || 'unknown',
      );
      if (signals.length > 0) {
        setDeals((prev) => [...signals, ...prev]);
        const lines = signals.map((d) => {
          const dir = signalDirection(d);
          if (dir === 'clearance') return `🔥 Clearance: ${d.item_name} — $${Number(d.new_price).toFixed(2)} (.97 find)`;
          if (dir === 'rise') {
            const pct = d.old_price ? Math.round((Number(d.new_price) / Number(d.old_price) - 1) * 100) : 0;
            return `📈 Price up ${pct}%: ${d.item_name} — $${Number(d.old_price).toFixed(2)} → $${Number(d.new_price).toFixed(2)}`;
          }
          const pct = d.old_price ? Math.round((1 - Number(d.new_price) / Number(d.old_price)) * 100) : 0;
          const save = d.old_price ? (Number(d.old_price) - Number(d.new_price)).toFixed(2) : '0.00';
          return `💸 Deal: ${d.item_name} — ${pct}% off (save $${save})`;
        });
        addNotification(`Price signals detected:\n${lines.join('\n')}`, 'success');
      }
    } catch (e) {
      console.warn('[deals] detection failed (best-effort)', e);
    }

    // Watchlist alerts (drops, rises, clearance) + bell.
    try {
      const storeName = stores.find((s) => s.id === storeId)?.name || 'Costco';
      const alertInputs = signals
        .filter((d) => favorites.includes(d.item_number || ''))
        .map((d) => {
          const dir = signalDirection(d);
          return {
            item_number: d.item_number || '',
            item_name: d.item_name || '',
            old_price: d.old_price != null ? Number(d.old_price) : null,
            new_price: Number(d.new_price),
            store_id: d.store_id || storeId || 'unknown',
            store_name: storeName,
            kind: (dir === 'rise' ? 'price_rise' : 'price_drop') as 'price_drop' | 'price_rise',
          };
        });
      if (alertInputs.length > 0) {
        await publishDealAlerts(alertInputs);
        const cloud = await fetchCloudNotifications().catch(() => [] as CloudNotification[]);
        if (cloud.length) setCloudAlerts(cloud);
      }
    } catch (e) {
      console.warn('[deals] alert publish failed (best-effort)', e);
    }

    // Receipt history + item reviews seeding.
    setReceipts((prev) => prev);
    afterShareStep();
  };

  const skipSharePublic = () => {
    setIsShareConsentOpen(false);
    if (FREE_LAUNCH) setIsFamilySharePromptOpen(true);
    else { setActiveTab('favorites'); addNotification('Items added to your Watchlist.', 'success'); }
  };

  // --- Groups ---
  const handleCreateGroup = (name: string, description: string, isPublic: boolean, storeId: string | null): void => {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `g${Date.now()}`;
    const newGroup: CommunityGroup = {
      id,
      name,
      description,
      creatorId: 'me',
      creatorEmail: (session as any)?.email || '',
      members: ['me'],
      pendingRequests: [],
      isPublic,
      storeId: storeId || undefined,
      keywords: [],
    };
    setGroups((prev) => [newGroup, ...prev]);
    setIsCreateGroupModalOpen(false);
    setActiveGroupId(id);
    setActiveTab('community');
    addNotification(`Group "${name}" created.`, 'success');
    // Cross-device: the debounced syncUpToCloud effect publishes this.
  };

  const handleJoinGroup = (groupId: string) => {
    setGroups((prev) => prev.map((g) =>
      g.id === groupId && !g.members.includes('me') ? { ...g, members: [...g.members, 'me'] } : g,
    ));
  };

  const handleEnterGroup = (groupId: string) => {
    setActiveGroupId(groupId);
    setActiveTab('community');
  };

  const handleSendComment = async (groupId: string, text: string, itemNumber?: string) => {
    const safety = checkMessageSafety(text);
    if (!safety.safe) {
      addNotification(MODERATION_WARNING, 'alert');
      return;
    }
    const comment: GroupComment = {
      id: crypto.randomUUID ? crypto.randomUUID() : `c${Date.now()}`,
      groupId,
      userId: 'me',
      userName: (session as any)?.name || 'Shopper',
      userAvatar: DEFAULT_AVATAR,
      text,
      itemNumber,
      timestamp: new Date().toISOString(),
    };
    setGroupComments((prev) => [...prev, comment]);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    // Cross-device: the debounced syncUpToCloud effect publishes this.
  };

  const handleReportMessage = (commentId: string) => {
    setGroupComments((prev) => prev.map((c) =>
      c.id === commentId ? { ...c, reported: true } : c,
    ));
    addNotification('Message reported. Our moderators will review it.', 'info');
  };

  const handleDismissReport = (commentId: string) => {
    setGroupComments((prev) => prev.map((c) =>
      c.id === commentId ? { ...c, reported: false } : c,
    ));
  };

  const handleMuteUser = (userId: string) => {
    setMutedUsers((prev) => ({ ...prev, [userId]: true }));
    addNotification('User muted. You will no longer see their messages.', 'info');
  };

  // --- Favorites & reviews ---
  const toggleFavorite = (itemNumber: string) => {
    setFavorites((prev) =>
      prev.includes(itemNumber) ? prev.filter((f) => f !== itemNumber) : [...prev, itemNumber],
    );
  };

  const handleAddReview = (itemNumber: string, itemName: string, rating: number, text: string) => {
    const review: ItemReview = {
      id: crypto.randomUUID ? crypto.randomUUID() : `r${Date.now()}`,
      userId: 'me',
      warehouseId: selectedStoreId || '',
      itemNumber, itemName, rating, text,
      userName: (session as any)?.name || 'Shopper',
      timestamp: new Date().toISOString(),
    };
    setItemReviews((prev) => [...prev, review]);
    addNotification('Review posted. Thanks for sharing!', 'success');
  };

  // --- Deal thread deep-link ---
  const openDealThread = (deal: DealSignal) => {
    const key = `signal:${deal.id}`;
    let thread = groups.find((g) => g.keywords?.includes(key));
    if (!thread) {
      const isClearance = deal.old_price == null;
      const pct = !isClearance && deal.old_price && deal.old_price > 0
        ? Math.round((1 - Number(deal.new_price) / Number(deal.old_price)) * 100) : 0;
      const storeName = stores.find((s) => s.id === deal.store_id)?.name || 'Costco';
      const dir = signalDirection(deal);
      const title = dir === 'clearance'
        ? `🔥 ${deal.item_name}: $${Number(deal.new_price).toFixed(2)} — Clearance`
        : dir === 'rise'
          ? `📈 ${deal.item_name}: price up`
          : `💰 ${deal.item_name}: $${Number(deal.old_price).toFixed(2)} → $${Number(deal.new_price).toFixed(2)}`;
      const newThread: CommunityGroup = {
        id: crypto.randomUUID ? crypto.randomUUID() : `g${Date.now()}`,
        name: title,
        description: dir === 'clearance'
          ? `Unadvertised .97 clearance spotted by the community at ${storeName}. When it's gone, it's gone — confirm it, discuss, or post a photo.`
          : dir === 'rise'
            ? `Heads up: this item went UP in price at ${storeName}. Buying now or waiting it out? Discuss below.`
            : `${pct}% price drop spotted by the community at ${storeName}. Confirm it, discuss, or post a photo.`,
        creatorId: 'me',
        creatorEmail: (session as any)?.email || '',
        members: ['me'],
        pendingRequests: [],
        isPublic: true,
        storeId: deal.store_id || undefined,
        keywords: ['deal-thread', key],
      };
      setGroups((prev) => (prev.some((g) => g.keywords?.includes(key)) ? prev : [newThread, ...prev]));
      thread = newThread;
    }
    setActiveTab('community');
    setActiveGroupId(thread.id);
  };

  // --- Derived data ---
  const catalog = useMemo(() => {
    let list = globalPrices;
    if (selectedStoreId) list = list.filter((p) => p.warehouseId === selectedStoreId);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((p) => p.itemName.toLowerCase().includes(q) || p.itemNumber.includes(q));
    }
    return list;
  }, [globalPrices, selectedStoreId, searchQuery]);

  const dashboardStats = useMemo(() => {
    const totalItems = catalog.length;
    const avgPrice = totalItems ? catalog.reduce((s, p) => s + p.price, 0) / totalItems : 0;
    const receiptsCount = receipts.length;
    const dealsCount = deals.length;
    return { totalItems, avgPrice, receiptsCount, dealsCount };
  }, [catalog, receipts, deals]);

  // --- Gates ---
  if (!isLegalAccepted) {
    return <LegalConsentGate onAccepted={() => {
      try {
        localStorage.setItem(LEGAL_KEY, JSON.stringify({ acceptedAt: new Date().toISOString(), versions: {} }));
      } catch { /* noop */ }
      setIsLegalAccepted(true);
    }} />;
  }

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-[#003366] text-white sticky top-0 z-40 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-black tracking-tight">C-Shopper</h1>
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">Price Scout</span>
          </div>
          {/* Desktop nav (lg and up) */}
          <nav className="hidden lg:flex items-center gap-1">
            <DesktopNavLink icon={<LayoutGrid size={16} />} label="Home" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
            <DesktopNavLink icon={<Search size={16} />} label="Search" active={activeTab === 'tracker'} onClick={() => setActiveTab('tracker')} />
            <DesktopNavLink icon={<Camera size={16} />} label="Scan" active={activeTab === 'upload'} onClick={() => setActiveTab('upload')} />
            <DesktopNavLink icon={<Tag size={16} />} label="Deals" active={activeTab === 'deals'} onClick={() => setActiveTab('deals')} />
            <DesktopNavLink icon={<Users size={16} />} label="Community" active={activeTab === 'community'} onClick={() => setActiveTab('community')} />
          </nav>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('deals')}
              className="relative p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-all"
              aria-label="Notifications"
            >
              <Bell size={18} />
              {cloudAlerts.filter((n) => !n.is_read).length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-[#E31837] rounded-full text-[10px] font-black flex items-center justify-center">
                  {cloudAlerts.filter((n) => !n.is_read).length}
                </span>
              )}
            </button>
            <button
              onClick={() => setIsStoreModalOpen(true)}
              className="px-3 py-1.5 bg-white/10 rounded-lg flex items-center gap-1.5 border border-white/5 active:bg-white/20 transition-all"
            >
              <MapPin size={14} className="text-[#E31837]" />
              <span className="text-[10px] font-black uppercase truncate max-w-[110px]">
                {storesReady ? shortStoreName(currentStore) : '…'}
              </span>
              {homeStoreId && selectedStoreId === homeStoreId && (
                <Star size={10} className="text-amber-400 shrink-0" />
              )}
            </button>
            <div
              onClick={() => setActiveTab('profile')}
              className="w-8 h-8 rounded-lg border border-white/20 overflow-hidden cursor-pointer"
            >
              <img src={DEFAULT_AVATAR} alt="avatar" />
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-6 pb-24 lg:pb-6">
        {activeTab === 'dashboard' && (
          <DashboardView
            stats={dashboardStats}
            deals={deals}
            stores={stores}
            onOpenThread={openDealThread}
            onNavigate={setActiveTab}
            catalog={catalog}
          />
        )}
        {activeTab === 'tracker' && (
          <TrackerView
            prices={catalog}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            favorites={favorites}
            receipts={receipts}
            subscriptionType={subscription.type}
            onToggleFavorite={toggleFavorite}
            onSelectItem={setActiveItemDetail}
            isWatchlistTab={false}
            stores={stores}
          />
        )}
        {activeTab === 'favorites' && (
          <TrackerView
            prices={catalog.filter((p) => favorites.includes(p.itemNumber))}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            favorites={favorites}
            receipts={receipts}
            subscriptionType={subscription.type}
            onToggleFavorite={toggleFavorite}
            onSelectItem={setActiveItemDetail}
            isWatchlistTab={true}
            stores={stores}
          />
        )}
        {activeTab === 'upload' && (
          <UploadView isScanning={isScanning} onFileChange={handleScan} />
        )}
        {activeTab === 'community' && (
          <CommunityHub
            groups={groups}
            activeGroupId={activeGroupId}
            setActiveGroupId={setActiveGroupId}
            groupComments={groupComments}
            onSendComment={handleSendComment}
            onJoin={handleJoinGroup}
            onEnter={handleEnterGroup}
            chatEndRef={chatEndRef}
            onOpenCreateGroup={() => setIsCreateGroupModalOpen(true)}
            selectedStoreId={selectedStoreId}
            storeName={currentStore?.name}
            mutedUsers={mutedUsers}
            onReportMessage={handleReportMessage}
            onMuteUser={handleMuteUser}
            onOpenModeration={() => setIsModerationOpen(true)}
          />
        )}
        {activeTab === 'profile' && (
          <ProfileView
            subscription={subscription}
            trialDaysLeft={trialDaysLeft}
            isExpired={isExpired}
            handleLogout={handleLogout}
            setActiveTab={setActiveTab}
            session={session}
            onOpenLegal={() => setIsLegalViewerOpen(true)}
            onOpenModeration={() => setIsModerationOpen(true)}
            onOpenFeedback={() => setIsFeedbackOpen(true)}
          />
        )}
        {activeTab === 'history' && (
          <ReceiptHistoryView receipts={receipts} stores={stores} onBack={() => setActiveTab('profile')} />
        )}
        {activeTab === 'pricing' && (
          <PricingView
            onSelectPlan={(plan) => { setSelectedPlan(plan); setIsBillingModalOpen(true); }}
            onFreeInfo={() => addNotification('Free launch — every tier is already unlocked for you.', 'success')}
          />
        )}
        {activeTab === 'deals' && (
          <DealsView deals={deals} stores={stores} onOpenThread={openDealThread} />
        )}
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t flex items-center justify-around px-2 z-50">
        <MobileNavLink icon={<LayoutGrid size={20} />} label="Home" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
        <MobileNavLink icon={<Search size={20} />} label="Search" active={activeTab === 'tracker'} onClick={() => setActiveTab('tracker')} />
        <MobileNavLink icon={<Camera size={20} />} label="Scan" active={activeTab === 'upload'} onClick={() => setActiveTab('upload')} />
        <MobileNavLink icon={<Tag size={20} />} label="Deals" active={activeTab === 'deals'} onClick={() => setActiveTab('deals')} />
        <MobileNavLink icon={<Users size={20} />} label="Community" active={activeTab === 'community'} onClick={() => setActiveTab('community')} />
      </nav>

      {/* Modals */}
      {isBillingModalOpen && (
        <BillingModal
          plan={selectedPlan}
          onClose={() => setIsBillingModalOpen(false)}
          onSubmit={() => {
            setSubscription({ ...subscription, status: 'active', isTrial: false, type: (selectedPlan || 'silver') as any });
            setIsBillingModalOpen(false);
          }}
        />
      )}
      {isCreateGroupModalOpen && (
        <CreateGroupModal
          onClose={() => setIsCreateGroupModalOpen(false)}
          onCreate={handleCreateGroup}
          storeId={selectedStoreId}
          storeName={currentStore?.name}
        />
      )}
      {isShareConsentOpen && (
        <ShareConsentModal
          items={lastScannedItems}
          toggles={shareToggles}
          onToggle={(id) => setShareToggles((prev) => ({ ...prev, [id]: prev[id] === false }))}
          onConfirm={confirmSharePublic}
          onSkip={skipSharePublic}
        />
      )}
      {isModerationOpen && (
        <ModerationView
          comments={groupComments}
          groups={groups}
          mutedUsers={mutedUsers}
          onDismiss={handleDismissReport}
          onRemove={(id) => setGroupComments((prev) => prev.filter((c) => c.id !== id))}
          onUnmute={(userId) => setMutedUsers((prev) => { const n = { ...prev }; delete n[userId]; return n; })}
          onClose={() => setIsModerationOpen(false)}
        />
      )}
      {isLegalViewerOpen && <LegalConsentGate onAccepted={() => setIsLegalViewerOpen(false)} />}
      {isFeedbackOpen && <FeedbackForm onClose={() => setIsFeedbackOpen(false)} />}
      {isStoreModalOpen && (
        <StoreSelector
          stores={stores}
          selectedStoreId={selectedStoreId}
          homeStoreId={homeStoreId}
          onSelect={handleSelectStore}
          onSetHome={handleSetHomeStore}
          onClose={() => setIsStoreModalOpen(false)}
        />
      )}
      {isScanResultModalOpen && (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 animate-slide-up overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black">Scan Results</h3>
              <button onClick={() => setIsScanResultModalOpen(false)} className="p-2 rounded-full hover:bg-slate-100">
                <X size={20} />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-2 mb-6">
              {lastScannedItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <div>
                    <p className="font-bold text-sm">{item.name}</p>
                    <p className="text-xs text-slate-500">{item.itemNumber}</p>
                  </div>
                  <p className="font-black text-sm">${item.price.toFixed(2)}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setIsScanResultModalOpen(false)}
                className="flex-1 py-3 rounded-xl border font-bold text-sm"
              >
                Done
              </button>
              <button
                onClick={afterScanAddAll}
                className="flex-1 py-3 rounded-xl bg-[#003366] text-white font-black text-sm"
              >
                Share Prices
              </button>
            </div>
          </div>
        </div>
      )}
      {isFamilySharePromptOpen && (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 text-center animate-slide-up">
            <Gift size={48} className="mx-auto mb-4 text-[#E31837]" />
            <h3 className="text-lg font-black mb-2">Share with Family?</h3>
            <p className="text-sm text-slate-600 mb-6">
              Your prices are live in the community. Want to also share this list privately with family?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setIsFamilySharePromptOpen(false); setActiveTab('favorites'); }}
                className="flex-1 py-3 rounded-xl border font-bold text-sm"
              >
                Skip
              </button>
              <button
                onClick={() => {
                  setSharedFamilyItems((prev) => [...prev, ...lastScannedItems.map((i) => i.itemNumber)]);
                  setIsFamilySharePromptOpen(false);
                  setActiveTab('favorites');
                  addNotification('Shared with family.', 'success');
                }}
                className="flex-1 py-3 rounded-xl bg-[#003366] text-white font-black text-sm"
              >
                Share
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-20 lg:bottom-6 right-4 z-[200] space-y-2 max-w-sm">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`p-4 rounded-2xl shadow-xl border text-sm font-medium animate-slide-up ${
              n.type === 'success' ? 'bg-green-50 border-green-200 text-green-900' :
              n.type === 'alert' ? 'bg-red-50 border-red-200 text-red-900' :
              'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <p className="whitespace-pre-line">{n.msg}</p>
          </div>
        ))}
      </div>

      {/* Item detail modal */}
      {activeItemDetail && (
        <ItemDetailModal
          itemNumber={activeItemDetail}
          globalPrices={globalPrices}
          reviews={itemReviews}
          warehouseId={selectedStoreId}
          onClose={() => setActiveItemDetail(null)}
          isFavorite={favorites.includes(activeItemDetail)}
          onToggleFavorite={() => toggleFavorite(activeItemDetail)}
          onAddReview={handleAddReview}
        />
      )}
    </div>
  );
}

// --- Dashboard ---
function DashboardView({ stats, deals, stores, onOpenThread, onNavigate, catalog }: any) {
  const recentReceipts = catalog.slice(0, 5);
  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase">Elite Dashboard</h2>
            <button
              onClick={() => onNavigate('upload')}
              className="bg-[#E31837] text-white p-3.5 rounded-xl shadow-xl active:scale-95 transition-all"
            >
              <Camera size={20} />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Monthly Spend" value={`$${stats.totalItems ? (catalog.reduce((s: number, p: any) => s + p.price, 0)).toFixed(2) : '0.00'}`} icon={<Receipt className="text-blue-600" size={16} />} />
            <StatCard label="Catalog Size" value={`${stats.totalItems}`} icon={<PackageCheck className="text-green-600" size={16} />} />
            <StatCard label="Watchlist" value={`${stats.dealsCount}`} icon={<Heart className="text-red-600" size={16} />} />
            <StatCard label="Plan" value="Free" icon={<Zap className="text-orange-600" size={16} />} />
          </div>
          <div className="bg-white p-6 rounded-[2rem] border shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-black tracking-tighter uppercase opacity-40">Recent Activity</h3>
            </div>
            {recentReceipts.length === 0 ? (
              <p className="text-sm text-slate-500">No items yet — scan a receipt to get started.</p>
            ) : (
              <div className="space-y-2">
                {recentReceipts.map((p: any) => (
                  <div key={p.itemNumber + p.warehouseId} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                    <div>
                      <p className="font-bold text-sm">{p.itemName}</p>
                      <p className="text-xs text-slate-500">{p.itemNumber}</p>
                    </div>
                    <p className="text-sm font-black shrink-0">${p.price.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="lg:w-72 space-y-4">
          <div className="p-6 rounded-[2rem] shadow-xl relative overflow-hidden transition-all bg-[#003366] text-white">
            <Tag className="absolute -right-4 -top-4 opacity-10" size={80} />
            <h4 className="text-[10px] font-black uppercase tracking-widest mb-4">Free Launch</h4>
            <p className="text-xs font-medium mb-6">Every feature is free during launch — no paywall, no trial clock.</p>
            <button
              onClick={() => onNavigate('pricing')}
              className="w-full py-3 bg-white text-[#003366] rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg"
            >
              View Plans
            </button>
          </div>
          <div className="bg-white p-6 rounded-[2rem] border shadow-sm">
            <h4 className="text-[10px] font-black uppercase tracking-widest mb-4 flex items-center gap-2 text-slate-400">
              <Tag size={12} /> Latest Deals
            </h4>
            {deals.length === 0 ? (
              <p className="text-[11px] text-slate-500 font-medium">No price drops spotted yet — share a receipt and deals light up here.</p>
            ) : (
              deals.slice(0, 3).map((d: DealSignal) => (
                <button
                  key={d.id}
                  onClick={() => onOpenThread(d)}
                  className="w-full text-left p-3 rounded-xl hover:bg-slate-50 transition-all mb-2 border"
                >
                  <p className="font-bold text-xs truncate">{d.item_name}</p>
                  <p className="text-[11px] text-slate-500">
                    ${Number(d.old_price).toFixed(2)} → ${Number(d.new_price).toFixed(2)}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Time ago helper ---
function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

// --- Deals feed ---
function DealsView({ deals, stores, onOpenThread }: { deals: DealSignal[]; stores: Store[]; onOpenThread: (d: DealSignal) => void }) {
  return (
    <div className="animate-fade-in space-y-4 max-w-3xl mx-auto">
      <div>
        <h2 className="text-xl font-black tracking-tight">Deals Feed</h2>
        <p className="text-xs text-slate-500 font-medium">Real price drops and clearance finds, spotted automatically from shared receipts.</p>
      </div>
      {deals.length === 0 ? (
        <div className="bg-white p-10 rounded-[2rem] border shadow-sm text-center">
          <div className="w-14 h-14 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Tag size={28} />
          </div>
          <h3 className="font-black mb-1">No deals yet</h3>
          <p className="text-xs text-slate-500 font-medium">When shoppers share receipts with lower prices — or .97 clearance finds — they appear here instantly.</p>
        </div>
      ) : (
        deals.map((d) => {
          const isClearance = d.old_price == null;
          const pct = !isClearance && d.old_price && d.old_price > 0
            ? Math.round((1 - Number(d.new_price) / Number(d.old_price)) * 100) : 0;
          const save = !isClearance && d.old_price ? Number(d.old_price) - Number(d.new_price) : 0;
          const storeName = stores.find((s) => s.id === d.store_id)?.name || 'Costco';
          const dir = signalDirection(d);
          return (
            <div key={d.id} className="bg-white rounded-[1.5rem] border shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black text-sm truncate">{d.item_name}</p>
                  <p className="text-[11px] text-slate-500 font-medium">{storeName} · {timeAgo(d.detected_at)}</p>
                </div>
                {isClearance ? (
                  <span className="text-[10px] font-black uppercase tracking-wider bg-orange-100 text-orange-700 px-2 py-1 rounded-lg shrink-0">Clearance .97</span>
                ) : dir === 'rise' ? (
                  <span className="text-[10px] font-black uppercase tracking-wider bg-red-100 text-red-700 px-2 py-1 rounded-lg shrink-0">Price Up</span>
                ) : (
                  <span className="text-[10px] font-black uppercase tracking-wider bg-green-100 text-green-700 px-2 py-1 rounded-lg shrink-0">-{pct}%</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-3">
                {!isClearance && (
                  <p className="text-xs text-slate-400 line-through">${Number(d.old_price).toFixed(2)}</p>
                )}
                <p className="text-xl font-black text-[#003366]">${Number(d.new_price).toFixed(2)}</p>
                {!isClearance && dir !== 'rise' && (
                  <p className="text-xs font-bold text-green-600">Save ${save.toFixed(2)}</p>
                )}
              </div>
              {dir === 'rise' ? (
                <p className="text-[11px] text-amber-700 font-medium mt-2">📈 This item went up in price — buying now or waiting it out? Tap Discuss.</p>
              ) : (
                <p className="text-[11px] text-slate-500 font-medium mt-2">💡 Bought in the last 30 days? Costco may refund the difference.</p>
              )}
              <button
                onClick={() => onOpenThread(d)}
                className="mt-3 w-full py-2.5 rounded-xl bg-[#003366] text-white text-xs font-black uppercase tracking-widest"
              >
                Discuss
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

// --- Receipt history ---
function ReceiptHistoryView({ receipts, stores, onBack }: { receipts: ReceiptItem[]; stores: Store[]; onBack: () => void }) {
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const byDate = useMemo(() => {
    const map = new Map<string, ReceiptItem[]>();
    const sorted = [...receipts].sort((a, b) =>
      String(b.purchaseDate || '').localeCompare(String(a.purchaseDate || '')),
    );
    for (const r of sorted) {
      const key = r.purchaseDate || 'Undated';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()];
  }, [receipts]);

  return (
    <div className="animate-fade-in max-w-3xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1 text-xs font-bold text-slate-500 mb-4">
        <ArrowLeft size={14} /> Back to Profile
      </button>
      <h2 className="text-xl font-black tracking-tight mb-1">Receipt History</h2>
      <p className="text-xs text-slate-500 font-medium mb-4">Every scan, grouped by purchase date.</p>
      {byDate.length === 0 ? (
        <div className="bg-white p-10 rounded-[2rem] border shadow-sm text-center">
          <History size={28} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-bold">No receipts yet</p>
          <p className="text-xs text-slate-500">Scan your first receipt to start your history.</p>
        </div>
      ) : (
        byDate.map(([date, items]) => {
          const total = items.reduce((s, i) => s + i.price, 0);
          const storeId = items.find((i) => i.warehouseId)?.warehouseId;
          const storeName = stores.find((s) => s.id === storeId)?.name;
          const open = expandedDate === date;
          return (
            <div key={date} className="bg-white rounded-[1.5rem] border shadow-sm mb-3 overflow-hidden">
              <button
                onClick={() => setExpandedDate(open ? null : date)}
                className="w-full p-4 flex items-center justify-between"
              >
                <div className="text-left">
                  <p className="font-black text-sm">{date}</p>
                  <p className="text-[11px] text-slate-500 font-medium">
                    {items.length} items{storeName ? ` · ${storeName}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-black text-sm">${total.toFixed(2)}</p>
                  <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                </div>
              </button>
              {open && (
                <div className="px-4 pb-4 space-y-2 border-t pt-3">
                  {items.map((i) => (
                    <div key={i.id} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="font-bold text-xs">{i.name}</p>
                        <p className="text-[10px] text-slate-400">{i.itemNumber}</p>
                      </div>
                      <p className="font-black text-xs">${i.price.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// --- Simple presentational components ---
function StatCard({ label, value, icon }: any) {
  return (
    <div className="bg-white p-4 rounded-2xl border shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
        {icon}
      </div>
      <p className="text-xl font-black">{value}</p>
    </div>
  );
}

function NavLink({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${active ? 'bg-[#003366] text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {label}
    </button>
  );
}

function MobileNavLink({ icon, label, active, onClick }: any) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 min-w-[56px]">
      <span className={active ? 'text-[#E31837]' : 'text-slate-400'}>{icon}</span>
      <span className={`text-[9px] font-bold uppercase tracking-wide ${active ? 'text-[#E31837]' : 'text-slate-400'}`}>{label}</span>
    </button>
  );
}

function DesktopNavLink({ icon, label, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-all ${active ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
    >
      {icon}
      {label}
    </button>
  );
}

function ProfileAction({ icon, label, onClick }: any) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 p-4 bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all text-left">
      <span className="text-slate-500">{icon}</span>
      <span className="font-bold text-sm">{label}</span>
      <ChevronRight size={16} className="ml-auto text-slate-300" />
    </button>
  );
}
/**
 * Reconstructed presentational components for App.tsx
 * Transliterated from the beautified production bundle (/tmp/bundle.pretty.js)
 * built from the pre-accident source. Components unchanged since the old
 * reference are copied verbatim; modified ones are transliterated from the
 * bundle (ground truth).
 *
 * NOTE: This file is a reconstruction staging area — it is NOT wired into
 * the app. The parent agent merges these into App.tsx.
 *
 * Icon mapping (bundle var -> lucide-react component):
 *   Heart, ArrowDownRight, Check, ShieldCheck, ChevronDown, Search, Plus,
 *   Star, X, Send, Smile, Tag, MapPin, Bell, Camera, Upload, ScanLine, etc.
 *   (full map at /tmp/iconmap.txt)
 */

import {
  Upload, ScanLine, MessageSquareHeart, Flag, VolumeX,
  ArrowRight, Ellipsis, FileText, RefreshCw,
  LoaderCircle, House, ChartColumn, WandSparkles,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// DealCard — VERBATIM from old reference (bundle uL @46549 verified identical)
// ---------------------------------------------------------------------------
function DealCard({ item, onSelectItem, isFavorite, onToggleFavorite, warehouse }: any) {
  return (
    <div onClick={onSelectItem} className="bg-white p-5 rounded-[2rem] border shadow-sm hover:shadow-xl transition-all relative group cursor-pointer flex flex-col border-transparent hover:border-slate-100 h-full">
      <div className="flex justify-between items-start mb-3">
         <div className="bg-blue-50 text-[#003366] px-2 py-0.5 rounded-lg border border-blue-100 w-fit">
            <span className="text-[8px] font-black uppercase tracking-tight truncate max-w-[100px]">{warehouse}</span>
         </div>
         <button onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }} className={`p-2 rounded-lg transition-all shadow-sm active:scale-90 ${isFavorite ? 'bg-red-50 text-red-500 border border-red-100' : 'bg-slate-50 text-slate-300 hover:text-red-300'}`}>
           <Heart size={14} fill={isFavorite ? "currentColor" : "none"} />
         </button>
      </div>
      <div className="flex-1">
         <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md text-[7px] font-black uppercase mb-1 inline-block">ID #{item.itemNumber}</span>
         <h4 className="font-black text-sm text-slate-900 leading-snug group-hover:text-[#E31837] transition-colors line-clamp-2 uppercase uppercase">{item.itemName}</h4>
         <p className="text-[8px] font-bold text-slate-300 uppercase tracking-widest mt-1">Updated {new Date(item.updatedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-50 flex items-end justify-between">
         <div>
            <p className="text-[8px] text-slate-400 font-black uppercase mb-1 leading-none uppercase uppercase">Price</p>
            <p className="text-2xl font-black text-slate-900 tracking-tighter leading-none">${item.price.toFixed(2)}</p>
         </div>
         <div className="p-1.5 bg-green-50 rounded-lg"><ArrowDownRight size={14} className="text-green-500"/></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BillingModal — VERBATIM from old reference (bundle dL @46788 verified identical)
// ---------------------------------------------------------------------------
function BillingModal({ plan, onClose, onSubmit }: any) {
  const [data, setData] = useState({ cardNumber: '', expiry: '', cvv: '', zip: '' });
  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
       <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 animate-slide-up">
          <div className="flex items-center gap-3 mb-4"><div className="p-2 bg-blue-50 text-[#003366] rounded-xl shrink-0"><ShieldCheck size={24}/></div><h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase leading-none">Upgrade Plan</h3></div>
          <p className="text-slate-400 font-medium mb-8 text-xs uppercase uppercase">Unlock your permanent {plan} tier features. Billing starts immediately.</p>
          <form onSubmit={(e) => { e.preventDefault(); onSubmit(data); }} className="space-y-4">
             <div className="space-y-1.5">
                <label className="text-[9px] font-black uppercase text-slate-400 ml-1 tracking-widest uppercase uppercase">Card Details</label>
                <input required placeholder="Card Number" className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3.5 font-bold text-sm outline-none focus:ring-2 ring-blue-500/10" value={data.cardNumber} onChange={e => setData({...data, cardNumber: e.target.value})} />
             </div>
             <div className="grid grid-cols-2 gap-3">
                <input required placeholder="MM/YY" className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3.5 font-bold text-sm outline-none focus:ring-2 ring-blue-500/10" value={data.expiry} onChange={e => setData({...data, expiry: e.target.value})} />
                <input required placeholder="CVV" className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3.5 font-bold text-sm outline-none focus:ring-2 ring-blue-500/10" value={data.cvv} onChange={e => setData({...data, cvv: e.target.value})} />
             </div>
             <button type="submit" className="w-full py-4 bg-[#003366] text-white rounded-2xl font-black text-base shadow-xl mt-6 active:scale-95 transition-all uppercase tracking-widest uppercase uppercase">Confirm & Upgrade</button>
             <button type="button" onClick={onClose} className="w-full text-[10px] font-black uppercase text-slate-300 mt-4 tracking-widest text-center uppercase uppercase">Cancel</button>
          </form>
       </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PriceCard — transliterated from bundle mh @46716 (MODIFIED: freeMode prop)
// ---------------------------------------------------------------------------
function PriceCard({ tier, price, features, highlight, freeMode, onSelect, onFreeInfo }: any) {
  return (
    <div className={`bg-white p-8 md:p-10 rounded-[2.5rem] border-4 flex flex-col items-center transition-all ${highlight ? "border-[#E31837] shadow-2xl scale-105" : "border-slate-50 shadow-sm hover:border-slate-200"}`}>
      <h3 className={`text-lg font-black tracking-tight mb-1 uppercase ${highlight ? "text-[#E31837]" : "text-slate-900"}`}>{tier}</h3>
      <div className="flex items-end justify-center mb-8">
        {freeMode ? (
          <span className="text-4xl md:text-5xl font-black text-green-600 tracking-tighter leading-none uppercase">FREE</span>
        ) : (
          <>
            <span className="text-4xl md:text-5xl font-black text-slate-900 tracking-tighter leading-none uppercase">${price}</span>
            <span className="text-slate-400 text-[10px] font-black mb-1.5 ml-0.5">/MO</span>
          </>
        )}
      </div>
      <ul className="text-left space-y-3.5 mb-10 flex-1 w-full">
        {features.map((f: string, i: number) => (
          <li key={i} className="text-[11px] font-bold text-slate-500 flex items-center gap-2.5 uppercase uppercase">
            <div className="bg-green-100 p-0.5 rounded-full"><Check size={10} className="text-green-600" strokeWidth={4} /></div> {f}
          </li>
        ))}
      </ul>
      <button onClick={freeMode ? onFreeInfo : onSelect} className={`w-full py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg active:scale-95 transition-all ${highlight ? "bg-[#E31837] text-white" : "bg-[#003366] text-white"} ${freeMode ? "opacity-90" : ""}`}>
        {freeMode ? "Included free" : `Select ${tier}`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PricingView — transliterated from bundle cL @46638 (MODIFIED: free launch)
// NOTE: `ph` is a module-level constant in the bundle (the FREE_LAUNCH flag).
// ---------------------------------------------------------------------------
const ph: boolean = FREE_LAUNCH;
function PricingView({ onSelectPlan, onFreeInfo }: any) {
  return (
    <div className="animate-fade-in space-y-10 text-center py-6">
      <div className="max-w-2xl mx-auto space-y-2">
        <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tighter uppercase uppercase">Membership Tiers</h2>
        <p className="text-slate-400 text-xs md:text-sm font-medium">Launch special: every feature is free for everyone right now. Paid plans arrive after launch.</p>
      </div>
      <div className="max-w-2xl mx-auto px-4">
        <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-3 text-green-800 text-xs font-bold uppercase tracking-wide">
          Free launch — all features unlocked for everyone. No payment needed.
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto px-4">
        <PriceCard tier="Silver Solo 👤" price="0" features={["5 scans/mo", "Email Price Drop Alerts", "Full Item Catalog"]} freeMode={ph} onSelect={() => onSelectPlan("silver")} onFreeInfo={onFreeInfo} />
        <PriceCard tier="Gold Max 2 👥" price="0" features={["Unlimited Scans", "Push Notifications", "Price Trend History", "Priority Support", "Community Access"]} highlight freeMode={ph} onSelect={() => onSelectPlan("gold")} onFreeInfo={onFreeInfo} />
        <PriceCard tier="Platinum Family 👨‍👩‍👧‍👦" price="0" features={["Family Account (3 Members)", "Shared Sync Watchlist", "VIP Price Matching", "Advanced Spend Charts", "Full Hub Permissions"]} freeMode={ph} onSelect={() => onSelectPlan("platinum")} onFreeInfo={onFreeInfo} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatMessageBubble — transliterated from bundle oL @45913 (NEW component;
// the old reference had no separate message component). Used by CommunityHub.
// Props: c=comment, menuOpen, onMenuToggle, onReport, onMute
// ---------------------------------------------------------------------------
function ChatMessageBubble({ c, menuOpen, onMenuToggle, onReport, onMute }: any) {
  const isMine = c.userId === "me";
  return (
    <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] p-3 rounded-2xl shadow-sm relative ${c.reported ? "opacity-50 grayscale" : ""} ${isMine ? "bg-[#003366] text-white" : "bg-white border text-slate-800"}`}
        onContextMenu={(e) => { e.preventDefault(); onMenuToggle(); }}
      >
        <div className="flex items-start gap-2">
          <p className="text-xs font-medium flex-1">{c.text}</p>
          <button
            onClick={(e) => { e.stopPropagation(); onMenuToggle(); }}
            aria-label="Message options"
            className={`p-1 rounded-md shrink-0 ${isMine ? "text-white/50 hover:text-white" : "text-slate-300 hover:text-slate-500"}`}
          >
            <Ellipsis size={14} />
          </button>
        </div>
        {c.reported && (
          <span className="inline-block mt-1.5 text-[8px] font-black uppercase bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Reported</span>
        )}
        {menuOpen && (
          <div onClick={(e) => e.stopPropagation()} className="absolute top-8 right-2 z-20 bg-white text-slate-800 rounded-xl shadow-2xl border border-slate-100 overflow-hidden w-40">
            {!c.reported && (
              <button onClick={() => { onReport(c.id); onMenuToggle(); }} className="w-full flex items-center gap-2 px-4 py-3 text-[11px] font-black uppercase hover:bg-slate-50">
                <Flag size={13} className="text-orange-500" /> Report
              </button>
            )}
            {!isMine && (
              <button onClick={() => { onMute(c.userId); onMenuToggle(); }} className="w-full flex items-center gap-2 px-4 py-3 text-[11px] font-black uppercase hover:bg-slate-50 border-t border-slate-50">
                <VolumeX size={13} className="text-slate-400" /> Mute user
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ItemDetailModal — transliterated from bundle rL @45582 (MODIFIED: stores
// prop, warehouse name, community price-history section via fetchPriceHistory)
// ---------------------------------------------------------------------------
function ItemDetailModal({ itemNumber, globalPrices, reviews, warehouseId, stores, onClose, isFavorite, onToggleFavorite, onAddReview }: any) {
  const item = globalPrices.find((p: any) => p.itemNumber === itemNumber);
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [reviewImage, setReviewImage] = useState<string | null>(null);
  const reviewFileRef = useRef<HTMLInputElement>(null);
  const [priceHistory, setPriceHistory] = useState<any[] | null>(null);

  const itemReviews = useMemo(() => reviews.filter((r: any) => r.itemNumber === itemNumber), [reviews, itemNumber]);
  const avgRating = itemReviews.length > 0 ? (itemReviews.reduce((a: number, b: any) => a + b.rating, 0) / itemReviews.length).toFixed(1) : "No rating";
  const storeName = (stores || []).find((s: any) => s.id === item?.warehouseId)?.name || "Your Costco";

  useEffect(() => {
    let cancelled = true;
    setPriceHistory(null);
    if (item != null && item.warehouseId) {
      fetchPriceHistory(itemNumber, item.warehouseId).then((rows) => {
        if (cancelled) setPriceHistory(rows);
      });
    } else {
      setPriceHistory([]);
    }
    return () => { cancelled = false; };
  }, [itemNumber, item?.warehouseId]);

  const handleReviewSubmit = () => {
    if (rating === 0 || !reviewText.trim()) return;
    onAddReview({ itemNumber, itemName: item.itemName, warehouseId, rating, text: reviewText, imageUrl: reviewImage || undefined });
    setRating(0); setReviewText(''); setReviewImage(null);
  };

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-md flex items-end md:items-center justify-center p-0 md:p-6 animate-fade-in">
       <div className="bg-white w-full max-w-2xl rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-slide-up">
          <div className="p-6 border-b flex items-center justify-between shrink-0">
             <div className="flex items-center gap-4 min-w-0">
                <div className="p-3 bg-slate-50 rounded-xl shrink-0"><ShoppingBasket size={24}/></div>
                <div className="min-w-0">
                   <h3 className="text-xl font-black text-slate-900 tracking-tighter truncate leading-tight uppercase">{item.itemName}</h3>
                   <div className="flex items-center gap-2">
                     <div className="flex items-center gap-0.5 text-orange-400">
                        <Star size={12} fill="currentColor"/>
                        <span className="text-[10px] font-black">{avgRating}</span>
                     </div>
                     <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">ID #{item.itemNumber}</span>
                   </div>
                </div>
             </div>
             <div className="flex gap-1.5 shrink-0 ml-4">
                <button onClick={() => onToggleFavorite(item.itemNumber)} className={`p-3 rounded-xl shadow-sm ${isFavorite ? "bg-red-50 text-red-500 border border-red-100" : "bg-white border text-slate-200 hover:text-red-300"}`}>
                   <Heart size={18} fill={isFavorite ? "currentColor" : "none"}/>
                </button>
                <button onClick={onClose} className="p-3 bg-slate-900 text-white rounded-xl hover:bg-black"><X size={18}/></button>
             </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
             <div className="p-6 bg-[#003366] text-white rounded-3xl border border-white/5 shadow-xl text-center">
                <p className="text-[10px] font-black uppercase opacity-60 mb-1">Local Noted Price</p>
                <span className="text-4xl font-black tracking-tighter">${item.price.toFixed(2)}</span>
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-2">at {storeName}</p>
             </div>
             <div className="space-y-3 bg-white p-6 rounded-[2rem] border shadow-sm">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-[#003366]">Price History</h4>
                {priceHistory === null ? (
                  <p className="text-xs font-bold text-slate-300 italic py-2">Loading community prices…</p>
                ) : priceHistory.length === 0 ? (
                  <p className="text-xs font-bold text-slate-300 italic py-2">No shared price history yet — scan a receipt to start it.</p>
                ) : (
                  <div className="space-y-1.5">
                    {priceHistory.slice(0, 8).map((h: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs font-bold text-slate-600 bg-slate-50 rounded-xl px-4 py-2.5">
                        <span className="uppercase tracking-wide">{new Date(h.observed_at).toLocaleDateString()}</span>
                        <span className="font-black text-slate-900">${Number(h.price).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
             </div>
             <div className="space-y-4 bg-white p-6 rounded-[2rem] border shadow-sm">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-[#003366] flex items-center gap-2"><Star size={14}/> Member Review</h4>
                <div className="flex items-center gap-1 mb-4">
                   {[1,2,3,4,5].map((s) => (
                     <button key={s} onClick={() => setRating(s)} className={`transition-all ${rating >= s ? "text-orange-400 scale-110" : "text-slate-200"}`}>
                       <Star size={24} fill={rating >= s ? "currentColor" : "none"}/>
                     </button>
                   ))}
                </div>
                <textarea placeholder="Experience at this warehouse?" className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm font-medium outline-none h-24" value={reviewText} onChange={(e) => setReviewText(e.target.value)} />
                <button onClick={handleReviewSubmit} disabled={rating === 0} className="w-full py-4 bg-[#E31837] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg disabled:opacity-50 active:scale-95">Post Review</button>
             </div>
             <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Recent Member Feedback</h4>
                <div className="space-y-3">
                   {itemReviews.length === 0 ? (
                     <p className="text-center opacity-30 italic text-sm font-bold py-8">No reviews yet.</p>
                   ) : itemReviews.map((r: any) => (
                     <div key={r.id} className="bg-slate-50 p-5 rounded-3xl border border-slate-100 space-y-2 shadow-sm">
                        <div className="flex justify-between items-start">
                           <div className="flex items-center gap-2">
                              <p className="text-[10px] font-black text-slate-900">{r.userName}</p>
                              <p className="text-[8px] font-bold text-slate-400 uppercase">{new Date(r.timestamp).toLocaleDateString()}</p>
                           </div>
                           <div className="flex items-center gap-0.5 text-orange-400">
                              {[...Array(r.rating)].map((_, i) => <Star key={i} size={8} fill="currentColor"/>)}
                           </div>
                        </div>
                        <p className="text-xs font-medium text-slate-700 leading-relaxed">{r.text}</p>
                     </div>
                   ))}
                </div>
             </div>
          </div>
       </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TrackerView — transliterated from bundle sL @45359 (MODIFIED: store-scoped
// filtering, store selector button, store-aware empty state, onScan CTA)
// NOTE: CATEGORIES is the module-level `eL` constant:
//   ["All","Pantry","Electronics","Frozen","Household","Fresh","Snacks","Beverages"]
// ---------------------------------------------------------------------------
function TrackerView({ prices, searchQuery, onSearchChange, favorites, receipts, subscriptionType, onToggleFavorite, onSelectItem, isWatchlistTab, stores, storeId, storeName, onOpenStoreSelector, onScan }: any) {
  const [selectedCategory, setSelectedCategory] = useState("All");

  const filteredItems = useMemo(() => {
    let list = storeId ? prices.filter((p: any) => p.warehouseId === storeId) : prices;
    if (isWatchlistTab) list = list.filter((p: any) => favorites.includes(p.itemNumber));
    if (selectedCategory !== "All") list = list.filter((p: any) => p.category === selectedCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p: any) => p.itemName.toLowerCase().includes(q) || p.itemNumber.includes(q));
    }
    return list;
  }, [prices, favorites, isWatchlistTab, selectedCategory, searchQuery, storeId]);

  const trackedBucket = useMemo(() => {
    if (!isWatchlistTab) return [];
    return receipts.filter((r: any) => favorites.includes(r.itemNumber));
  }, [receipts, favorites, isWatchlistTab]);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
         <div className="flex-1">
            <h2 className="text-2xl font-black text-slate-900 tracking-tighter leading-none mb-2 uppercase">
              {isWatchlistTab ? 'Watchlist' : 'Item Catalog'}
            </h2>
            <p className="text-slate-400 font-bold uppercase text-[9px] tracking-widest italic">
              {isWatchlistTab ? 'Personalized price alert bucket' : 'Search by Name or Item Number'}
            </p>
            {storeName && (
              <button onClick={onOpenStoreSelector} className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#003366] bg-blue-50 border border-blue-100 rounded-full px-3 py-1.5 hover:bg-blue-100 transition-all">
                <MapPin size={11} className="text-[#E31837]" /> {storeName}
              </button>
            )}
         </div>
         <div className="relative w-full max-w-sm">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
            <input type="text" placeholder="Search items..." value={searchQuery} onChange={e => onSearchChange(e.target.value)} className="pl-10 pr-4 py-3 bg-white border rounded-xl w-full font-bold text-sm shadow-sm outline-none" />
         </div>
      </div>

      {isWatchlistTab && trackedBucket.length > 0 && (
        <div className="bg-[#003366] p-6 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden border border-white/5 mb-8">
           <div className="absolute -right-6 -top-6 opacity-5 rotate-12"><History size={150}/></div>
           <p className="text-[10px] font-black uppercase tracking-widest mb-4 flex items-center gap-2 text-blue-200 relative z-10">
             <Target size={14} className="text-[#E31837]"/> Tracking Bucket (Historical Prices)
           </p>
           <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar relative z-10">
             {trackedBucket.map((item: any) => (
               <div key={item.id} className="bg-white/10 border border-white/10 p-5 rounded-2xl min-w-[200px] shrink-0 backdrop-blur-md cursor-pointer" onClick={() => onSelectItem(item.itemNumber)}>
                  <p className="text-xs font-black truncate mb-1">{item.name}</p>
                  <p className="text-xl font-black text-white">${item.price.toFixed(2)}</p>
                  <div className="mt-4 pt-2 border-t border-white/5 flex items-center justify-between">
                    <span className="text-[8px] font-bold text-blue-400 uppercase">Paid: {new Date(item.purchaseDate).toLocaleDateString()}</span>
                    <TrendingDown size={12} className="text-green-400"/>
                  </div>
               </div>
             ))}
           </div>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar whitespace-nowrap">
         {CATEGORIES.map(c => (
           <button key={c} onClick={() => setSelectedCategory(c)} className={`px-4 py-2 rounded-full text-[9px] font-black uppercase transition-all ${selectedCategory === c ? 'bg-[#003366] text-white shadow-md' : 'bg-white text-slate-400 border border-slate-100'}`}>{c}</button>
         ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredItems.length === 0 ? (
          <div className="col-span-full py-20 text-center">
            <MapPin size={28} className="mx-auto mb-4 text-slate-200" />
            <p className="italic text-sm font-bold opacity-30 mb-1">{storeId ? `No prices shared at ${storeName || "this Costco"} yet.` : "No items found. Try searching by Name or Item ID."}</p>
            {storeId && (
              <>
                <p className="text-xs font-bold text-slate-400 mb-6">Scan a receipt to be the first to share prices here.</p>
                <button onClick={onScan} className="px-6 py-3 bg-[#E31837] text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg active:scale-95">Scan a receipt</button>
              </>
            )}
          </div>
        ) : filteredItems.map((p: any) => (
          <DealCard key={p.itemNumber} item={p} isFavorite={favorites.includes(p.itemNumber)} onToggleFavorite={() => onToggleFavorite(p.itemNumber)} onSelectItem={() => onSelectItem(p.itemNumber)} warehouse={stores.find((s: any) => s.id === p.warehouseId)?.name || 'Local'} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProfileView — transliterated from bundle lL @46257 (MODIFIED: free-launch
// status card, FREE tier labels, Receipt History -> 'history' tab, Send
// Feedback row). NOTE: `Bu` was a module-level imported profile image asset
// in the bundle; reconstructed here as the default avatar.
// ---------------------------------------------------------------------------
const Bu: string = DEFAULT_AVATAR;
function ProfileView({ subscription, trialDaysLeft, isExpired, handleLogout, setActiveTab, session, onOpenLegal, onOpenModeration, onOpenFeedback }: any) {
  return (
    <div className="animate-fade-in space-y-4 max-w-4xl mx-auto">
      <div className="bg-white p-4 md:p-6 rounded-[2rem] border border-slate-100 shadow-sm flex items-center gap-4 text-left">
        <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl overflow-hidden shadow-md border-2 border-white shrink-0">
          <img src={Bu} alt="profile" className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase truncate">{session?.name || "C-SHOPPER Elite"}</h3>
            <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest border ${isExpired ? "bg-red-50 text-red-600 border-red-100" : "bg-blue-50 text-blue-600 border-blue-100"}`}>Free {isExpired && "(Expired)"}</span>
          </div>
          {session?.email && <p className="text-[11px] font-bold text-slate-400 truncate mb-2">{session.email}</p>}
          <div className="flex items-center gap-4">
            <button onClick={() => setActiveTab("pricing")} className="text-[#003366] font-black text-[10px] uppercase tracking-widest flex items-center gap-1 hover:underline">Manage</button>
            <button onClick={handleLogout} className="text-red-500 font-black text-[10px] uppercase tracking-widest flex items-center gap-1 hover:underline">Logout</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={`${isExpired ? "bg-red-600" : "bg-[#003366]"} p-6 rounded-[2rem] text-white shadow-lg relative overflow-hidden transition-all h-fit`}>
          <ShieldAlert className="absolute -right-4 -top-4 opacity-10 rotate-12" size={100} />
          <h4 className="text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-2 text-white/60 uppercase"><CalendarDays size={14} /> Launch Status</h4>
          <p className="text-xs font-bold text-white mb-2 leading-tight uppercase">Free Launch — all features unlocked.</p>
          <p className="text-[10px] font-medium text-white/80 mb-6 uppercase">No paywall during launch. Enjoy everything.</p>
          {!isExpired && (
            <div className="w-full bg-white/10 rounded-full h-1.5">
              <div className="bg-[#E31837] h-full rounded-full transition-all duration-1000" style={{ width: `${Math.min(100, ((30 - trialDaysLeft) / 30) * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="bg-white p-6 rounded-[2rem] border shadow-sm">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 uppercase">Upgrade Options</h4>
          <div className="space-y-2">
            <button onClick={() => setActiveTab("pricing")} className="w-full p-3.5 rounded-xl border border-blue-100 hover:border-blue-500 hover:bg-blue-50/30 transition-all text-left group">
              <div className="flex justify-between items-center">
                <p className="text-xs font-black text-slate-900 group-hover:text-blue-600 transition-colors uppercase">Silver Solo 👤</p>
                <span className="text-[10px] font-black text-blue-600">FREE</span>
              </div>
            </button>
            <button onClick={() => setActiveTab("pricing")} className="w-full p-3.5 rounded-xl border border-orange-100 hover:border-orange-500 hover:bg-orange-50/30 transition-all text-left group">
              <div className="flex justify-between items-center">
                <p className="text-xs font-black text-slate-900 group-hover:text-orange-600 transition-colors uppercase">Gold Max 2 👥</p>
                <span className="text-[10px] font-black text-orange-600">FREE</span>
              </div>
            </button>
            <button onClick={() => setActiveTab("pricing")} className="w-full p-3.5 rounded-xl border border-red-100 hover:border-[#E31837] hover:bg-red-50/30 transition-all text-left group">
              <div className="flex justify-between items-center">
                <p className="text-xs font-black text-slate-900 group-hover:text-[#E31837] transition-colors uppercase">Platinum Family 👨‍👩‍👧‍👦</p>
                <span className="text-[10px] font-black text-[#E31837]">FREE</span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white p-4 rounded-[2rem] border shadow-sm">
        <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2 px-2 uppercase">Settings & History</h4>
        <ProfileAction icon={<History size={14} />} label="Receipt History" onClick={() => setActiveTab("history")} />
        <ProfileAction icon={<MessageSquare size={14} />} label="Community Posts" onClick={() => setActiveTab("community")} />
        <ProfileAction icon={<ShieldAlert size={14} />} label="Moderation" onClick={onOpenModeration} />
        <ProfileAction icon={<MessageSquareHeart size={14} />} label="Send Feedback" onClick={onOpenFeedback} />
        <ProfileAction icon={<FileText size={14} />} label="Legal" onClick={onOpenLegal} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommunityHub — transliterated from bundle aL @45982 (MODIFIED: private-group
// creatorEmail hiding, muted-user filtering, message context menu via
// ChatMessageBubble, store badges, emoji picker).
// NOTE: EMOJI_LIST is defined at module top; reused here.
// ---------------------------------------------------------------------------

function CommunityHub({ groups, activeGroupId, setActiveGroupId, groupComments, onSendComment, onJoin, onOpenCreateGroup, onOpenModeration, mutedUsers, onReportMessage, onMuteUser, chatEndRef, selectedStoreId, storeName, stores, sessionEmail }: any) {
  const [commentText, setCommentText] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [groupSearch, setGroupSearch] = useState("");

  const activeGroup = groups.find((g: any) => g.id === activeGroupId);
  const mutedIds = (mutedUsers && activeGroupId && mutedUsers[activeGroupId]) || [];
  const visibleComments = groupComments.filter((c: any) => c.groupId === activeGroupId && !mutedIds.includes(c.userId));

  const orderedGroups = useMemo(() => {
    const rank = (g: any) => g.storeId && g.storeId === selectedStoreId ? 0 : g.storeId ? 2 : 1;
    const q = groupSearch.trim().toLowerCase();
    return [
      // Private groups: visible only to members, and hidden from other
      // local-login identities via creatorEmail.
      ...groups.filter((g: any) =>
        g.isPublic !== false
          ? true
          : (g.members || []).includes("me") && !(g.creatorEmail && sessionEmail && g.creatorEmail !== sessionEmail)
      ),
    ]
      .filter((g: any) => {
        if (!q) return true;
        const haystack = [
          g.name || "",
          g.description || "",
          ...(g.keywords || []),
        ].join(" ").toLowerCase();
        return haystack.includes(q);
      })
      .sort((a: any, b: any) => rank(a) - rank(b));
  }, [groups, selectedStoreId, sessionEmail, groupSearch]);

  const storeNameOf = (id: string) => stores?.find((s: any) => s.id === id)?.name;

  const sendMessage = () => {
    if (commentText.trim()) {
      onSendComment(activeGroupId, commentText);
      setCommentText("");
      setShowEmoji(false);
    }
  };

  // --- Thread view ---
  if (activeGroupId && activeGroup) {
    return (
      <div className="animate-fade-in flex flex-col h-full bg-white rounded-[2rem] border shadow-xl overflow-hidden" onClick={() => setMenuOpenId(null)}>
        <div className="p-4 bg-[#003366] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setActiveGroupId(null)} className="p-2 bg-white/10 rounded-lg shrink-0"><ArrowLeft size={16} /></button>
            <h3 className="text-sm font-black uppercase tracking-widest truncate">{activeGroup.name}</h3>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onOpenModeration(); }} aria-label="Moderation" className="p-2 bg-white/10 rounded-lg shrink-0"><ShieldAlert size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 custom-scrollbar">
          {visibleComments.map((c: any) => (
            <ChatMessageBubble
              key={c.id}
              c={c}
              menuOpen={menuOpenId === c.id}
              onMenuToggle={() => setMenuOpenId((prev) => (prev === c.id ? null : c.id))}
              onReport={onReportMessage}
              onMute={(userId: string) => onMuteUser(activeGroupId, userId)}
            />
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="p-3 border-t bg-white relative">
          {showEmoji && (
            <div className="absolute bottom-full left-0 right-0 bg-white border-t p-4 flex flex-wrap gap-3 shadow-2xl animate-slide-up z-20">
              {EMOJI_LIST.map((e) => (
                <button key={e} onClick={() => { setCommentText((prev) => prev + e); setShowEmoji(false); }} className="text-2xl hover:scale-125 transition-transform">{e}</button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button onClick={() => setShowEmoji(!showEmoji)} className="p-3 bg-slate-50 rounded-xl text-slate-400 hover:text-[#003366] transition-colors"><Smile size={20} /></button>
            <input type="text" placeholder="Scout update..." className="flex-1 bg-slate-50 border p-3 rounded-xl outline-none text-sm font-bold" value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} />
            <button onClick={sendMessage} className="bg-[#E31837] text-white p-3 rounded-xl shadow-md active:scale-90 transition-all"><Send size={18} /></button>
          </div>
        </div>
      </div>
    );
  }

  // --- Group directory ---
  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex justify-between items-center gap-3">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tighter uppercase">Local Hubs</h2>
          {storeName && (
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1 flex items-center gap-1">
              <MapPin size={10} className="text-[#E31837]" /> Showing {storeName} first
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onOpenModeration} aria-label="Moderation queue" className="p-2.5 bg-white border border-slate-100 rounded-xl text-slate-400 hover:text-orange-500 shadow-sm"><ShieldAlert size={16} /></button>
          <button onClick={onOpenCreateGroup} className="flex items-center gap-2 px-4 py-2.5 bg-[#E31837] text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg active:scale-95"><Plus size={14} /> Create group</button>
        </div>
      </div>
      <div className="relative">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={groupSearch}
          onChange={(e) => setGroupSearch(e.target.value)}
          placeholder="Search groups by name or keyword…"
          className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#E31837]/30 focus:border-[#E31837]"
        />
        {groupSearch && (
          <button
            onClick={() => setGroupSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-slate-100 text-slate-400"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {groupSearch.trim() && orderedGroups.length === 0 ? (
        <div className="bg-white p-10 rounded-[2rem] border shadow-sm text-center">
          <Search size={28} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-bold">No groups match "{groupSearch.trim()}"</p>
          <p className="text-xs text-slate-500 mt-1">Try a different keyword, or create a new group.</p>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {orderedGroups.map((g: any) => (
          <div key={g.id} className="bg-white p-6 rounded-[2rem] border shadow-sm flex flex-col justify-between h-full group hover:shadow-xl transition-all border-transparent hover:border-slate-100">
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h4 className="text-lg font-black text-slate-900 tracking-tighter uppercase group-hover:text-[#E31837] transition-colors">{g.name}</h4>
                {!g.isPublic && <Lock size={12} className="text-slate-300" />}
                {g.storeId && (
                  <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${g.storeId === selectedStoreId ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                    {g.storeId === selectedStoreId ? "Your Costco" : (storeNameOf(g.storeId)?.split(" ")[0] || "Store hub")}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-medium mb-4 line-clamp-2">{g.description}</p>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-slate-50">
              <span className="text-[9px] font-black uppercase text-slate-400">{g.members.length} Scouts</span>
              <button onClick={() => { g.members.includes("me") ? setActiveGroupId(g.id) : onJoin(g.id); }} className="bg-[#003366] text-white px-6 py-2 rounded-lg font-black text-[9px] uppercase shadow-lg hover:bg-black transition-all">
                {g.members.includes("me") ? "Enter" : "Join Group"}
              </button>
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UploadView — transliterated from bundle HD @28919 (COMPLETELY REWRITTEN vs
// old reference: smart capture with camera, auto corner detection, draggable
// perspective-crop overlay, sharpen toggle).
// Module helpers used (defined elsewhere in the bundle, NOT reconstructed):
//   SD(img, maxDim)  — downscale/preprocess for detection
//   DD(processed)    — detect receipt corners -> {tl,tr,br,bl} | null
//   A_(w, h, margin) — default full-frame corners
//   GD(img, corners, sharpen) — perspective-correct crop -> dataURL
// Icons: ScanLine, Camera, Upload, X, WandSparkles, RefreshCw, Check
// ---------------------------------------------------------------------------
function UploadView({ isScanning, onFileChange }: any) {
  return <ReceiptScanner isScanning={isScanning} onExtract={onFileChange} />;
}

