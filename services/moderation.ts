/**
 * moderation.ts — chat moderation + receipt PII stripping for C-Shopper.
 *
 * Two jobs, one home so the rules can grow together:
 *   1. Chat send-time PII filter: blocks messages containing card-number-like
 *      (12+ consecutive digits) or SSN-like (###-##-####) patterns.
 *   2. Receipt PII stripper: scrubs card numbers, auth codes, member IDs and
 *      any 12+ digit sequences from PARSED receipt data on-device, before any
 *      share/public action. Raw receipt images/text never leave the device.
 */

export interface MessageSafety {
  safe: boolean;
  blockedKind?: 'card' | 'ssn';
}

/** Toast copy shown when a chat message is blocked. */
export const MODERATION_WARNING =
  "Message blocked: don't share card numbers or personal IDs in public chat.";

const LONG_DIGIT_RUN = /\d{12,}/;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;

/** Returns { safe: false } when the text looks like it contains payment/PII data. */
export function checkMessageSafety(text: string): MessageSafety {
  const t = text || '';
  if (SSN_PATTERN.test(t)) return { safe: false, blockedKind: 'ssn' };
  if (LONG_DIGIT_RUN.test(t)) return { safe: false, blockedKind: 'card' };
  return { safe: true };
}

// ---------------------------------------------------------------------------
// Receipt PII stripping
// ---------------------------------------------------------------------------

/** Patterns scrubbed from parsed receipt fields before any share action. */
const AUTH_CODE_PATTERN = /\b(auth|approval|member|card)\s*(code|no\.?|number|num|id)?\s*[:#]?\s*\S+/gi;
const GENERIC_LONG_RUN = /\d{12,}/g;

/** Scrub PII from a single free-text receipt field. Item numbers (6 digits)
 *  and prices are untouched — only 12+ digit runs, SSN shapes and
 *  card/auth/member code fields are redacted. */
export function scrubReceiptField(value: string | undefined): string {
  const s = value || '';
  return s
    .replace(SSN_PATTERN, '[redacted]')
    .replace(AUTH_CODE_PATTERN, '[redacted]')
    .replace(GENERIC_LONG_RUN, '[redacted]');
}

export interface StrippableReceiptItem {
  itemNumber: string;
  name: string;
}

/**
 * stripReceiptPII — remove card numbers, auth codes, member IDs and any 12+
 * digit sequences from parsed receipt items ON-DEVICE. Call this on the
 * parsed scan result BEFORE anything is shared publicly or queued for sync.
 * Returns new objects; the input is not mutated.
 */
export function stripReceiptPII<T extends StrippableReceiptItem>(items: T[]): T[] {
  return items.map((item) => ({
    ...item,
    itemNumber: scrubReceiptField(item.itemNumber),
    name: scrubReceiptField(item.name),
  }));
}
