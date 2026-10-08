/**
 * legal.ts — first-launch legal consent plumbing.
 *
 * The three documents live in public/legal/*.md (copied there from the legal
 * lane's sources) and are fetched at runtime so the legal team can update the
 * text without a code change. Doc versions are recorded alongside the
 * acceptance timestamp in `ws_legal_accept`.
 */

export interface LegalDoc {
  id: 'tos' | 'privacy' | 'guidelines';
  title: string;
  path: string; // served from public/
}

/** Bump a doc's version when its text changes materially — acceptance records
 *  store these, so we can detect when a user needs to re-accept. */
export const LEGAL_VERSIONS: Record<LegalDoc['id'], string> = {
  tos: 'v1-2026-10-07',
  privacy: 'v1-2026-10-07',
  guidelines: 'v1-2026-10-07',
};

export const LEGAL_DOCS: LegalDoc[] = [
  { id: 'tos', title: 'Terms of Service', path: '/legal/terms-of-service.md' },
  { id: 'privacy', title: 'Privacy Policy', path: '/legal/privacy-policy.md' },
  { id: 'guidelines', title: 'Community Guidelines', path: '/legal/community-guidelines.md' },
];

export const LEGAL_ACCEPT_KEY = 'ws_legal_accept';
export const LEGAL_FALLBACK_TEXT =
  'Full legal text loading — final review in progress.';

export interface LegalAcceptance {
  acceptedAt: string; // ISO timestamp
  versions: Record<LegalDoc['id'], string>;
}

export function getLegalAcceptance(): LegalAcceptance | null {
  try {
    const raw = localStorage.getItem(LEGAL_ACCEPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LegalAcceptance;
    if (!parsed || typeof parsed.acceptedAt !== 'string' || !parsed.versions) return null;
    return parsed;
  } catch {
    try { localStorage.removeItem(LEGAL_ACCEPT_KEY); } catch { /* ignore */ }
    return null;
  }
}

export function recordLegalAcceptance(): LegalAcceptance {
  const record: LegalAcceptance = {
    acceptedAt: new Date().toISOString(),
    versions: { ...LEGAL_VERSIONS },
  };
  try {
    localStorage.setItem(LEGAL_ACCEPT_KEY, JSON.stringify(record));
  } catch { /* storage unavailable */ }
  return record;
}

export interface LoadedLegalDoc {
  doc: LegalDoc;
  /** First "DRAFT …" line lifted out of the body so it can render as a banner. */
  draftNotice: string | null;
  body: string;
}

/** Fetch a legal markdown file; falls back to placeholder text on any error
 *  so the consent gate still functions and the build stays clean. */
export async function loadLegalDoc(doc: LegalDoc): Promise<LoadedLegalDoc> {
  try {
    const res = await fetch(doc.path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    const lines = raw.split('\n');
    let draftNotice: string | null = null;
    let body = raw;
    if (lines[0] && lines[0].trim().toUpperCase().startsWith('DRAFT')) {
      draftNotice = lines[0].trim();
      body = lines.slice(1).join('\n').trim();
    }
    return { doc, draftNotice, body: body || LEGAL_FALLBACK_TEXT };
  } catch {
    return { doc, draftNotice: null, body: LEGAL_FALLBACK_TEXT };
  }
}

// ---------------------------------------------------------------------------
// Tiny markdown renderer (headings, bold, lists, rules, paragraphs).
// Deliberately minimal — no dependency, XSS-safe by construction since we
// escape HTML before applying inline formatting.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/** Render a small markdown subset to an HTML string. */
export function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };

  for (const line of lines) {
    const t = line.trim();
    if (t === '' || t === '---') { closeList(); continue; }
    const h3 = t.match(/^###\s+(.*)/);
    const h2 = t.match(/^##\s+(.*)/);
    const h1 = t.match(/^#\s+(.*)/);
    const li = t.match(/^[-*]\s+(.*)/);
    const ol = t.match(/^\d+\.\s+(.*)/);
    if (h3) { closeList(); out.push(`<h4>${inline(h3[1])}</h4>`); }
    else if (h2) { closeList(); out.push(`<h3>${inline(h2[1])}</h3>`); }
    else if (h1) { closeList(); out.push(`<h2>${inline(h1[1])}</h2>`); }
    else if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
    } else if (ol) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(ol[1])}</li>`);
    } else { closeList(); out.push(`<p>${inline(t)}</p>`); }
  }
  closeList();
  return out.join('');
}
