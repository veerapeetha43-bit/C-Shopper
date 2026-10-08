/**
 * feedback.ts — in-app feedback outbox.
 *
 * Offline-first: submissions are stored in localStorage (`ws_feedback_outbox`)
 * and flushed to the Supabase `feedback` table by services/cloud.ts
 * (flushFeedbackOutbox) when the cloud is configured. The CTO triages by
 * star rating (1* = urgent attention, 5* = praise / validation).
 */

export type FeedbackCategory = 'bug' | 'feature' | 'price-data' | 'other';

export interface FeedbackEntry {
  id: string;
  stars: number; // 1-5
  category: FeedbackCategory;
  body: string; // max 1000 chars
  app_version: string;
  created_at: string; // ISO timestamp
  synced: boolean;
}

export const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature idea' },
  { value: 'price-data', label: 'Price data issue' },
  { value: 'other', label: 'Something else' },
];

export const APP_VERSION = '2.0.0';
const OUTBOX_KEY = 'ws_feedback_outbox';
const MAX_BODY = 1000;

function safeId(): string {
  try {
    return crypto.randomUUID ? crypto.randomUUID() : `fb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  } catch {
    return `fb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function loadFeedbackOutbox(): FeedbackEntry[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFeedbackOutbox(entries: FeedbackEntry[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
  } catch {
    /* storage full / unavailable — feedback is best-effort offline */
  }
}

/** Validate + queue a feedback submission. Returns the stored entry. */
export function submitFeedback(stars: number, category: FeedbackCategory, body: string): FeedbackEntry {
  const cleanStars = Math.min(5, Math.max(1, Math.round(stars)));
  const cleanBody = body.trim().slice(0, MAX_BODY);
  if (!cleanBody) throw new Error('Feedback text is required.');
  const entry: FeedbackEntry = {
    id: safeId(),
    stars: cleanStars,
    category,
    body: cleanBody,
    app_version: APP_VERSION,
    created_at: new Date().toISOString(),
    synced: false,
  };
  const outbox = loadFeedbackOutbox();
  outbox.push(entry);
  saveFeedbackOutbox(outbox);
  return entry;
}

/** Mark entries as synced after a successful cloud flush. */
export function markFeedbackSynced(ids: string[]): void {
  const outbox = loadFeedbackOutbox();
  const idSet = new Set(ids);
  saveFeedbackOutbox(outbox.map((e) => (idSet.has(e.id) ? { ...e, synced: true } : e)));
}

export function pendingFeedbackCount(): number {
  return loadFeedbackOutbox().filter((e) => !e.synced).length;
}
