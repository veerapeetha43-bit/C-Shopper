/**
 * FeedbackForm — in-app feedback: 1-5 star rating, category, free text.
 *
 * Offline-first: submit writes to the localStorage outbox (ws_feedback_outbox);
 * services/cloud.ts flushes it to Supabase when the backend is configured.
 */
import React, { useState } from 'react';
import { X, Star, Send, CheckCircle2, MessageSquareHeart } from 'lucide-react';
import { submitFeedback, FEEDBACK_CATEGORIES, type FeedbackCategory } from '../services/feedback';

const MAX_BODY = 1000;

export default function FeedbackForm({ onClose }: { onClose: () => void }) {
  const [stars, setStars] = useState(0);
  const [hoverStars, setHoverStars] = useState(0);
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const canSubmit = stars > 0 && body.trim().length > 0;

  const handleSubmit = () => {
    setError('');
    if (stars === 0) {
      setError('Please tap a star rating first.');
      return;
    }
    if (!body.trim()) {
      setError('Please tell us what\u2019s on your mind.');
      return;
    }
    try {
      submitFeedback(stars, category, body);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    }
  };

  const shownStars = hoverStars || stars;

  return (
    <div className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-md flex items-end md:items-center justify-center p-0 md:p-6 animate-fade-in">
      <div className="bg-white w-full max-w-lg rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-slide-up">
        <div className="p-6 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#003366]/10 text-[#003366] rounded-xl"><MessageSquareHeart size={20} /></div>
            <div>
              <h3 className="text-lg font-black text-slate-900 tracking-tighter uppercase leading-none">Send Feedback</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Help us make C-Shopper better</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-slate-900 text-white rounded-xl hover:bg-black" aria-label="Close feedback">
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div className="p-10 flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-[1.5rem] flex items-center justify-center mb-5">
              <CheckCircle2 size={32} />
            </div>
            <h4 className="text-xl font-black text-slate-900 tracking-tighter uppercase mb-2">Thanks!</h4>
            <p className="text-sm font-medium text-slate-500 leading-relaxed mb-8">
              Thanks — the team reads every one.
            </p>
            <button
              onClick={onClose}
              className="w-full py-4 bg-[#003366] text-white rounded-2xl font-black text-base uppercase active:scale-95 transition-all shadow-xl"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {/* Star rating */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
                How was your experience? <span className="text-[#E31837]">*</span>
              </p>
              <div className="flex gap-2" role="radiogroup" aria-label="Star rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={stars === n}
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                    onClick={() => setStars(n)}
                    onMouseEnter={() => setHoverStars(n)}
                    onMouseLeave={() => setHoverStars(0)}
                    className="p-1 active:scale-90 transition-transform"
                  >
                    <Star
                      size={36}
                      className={n <= shownStars ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Category */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
                What&rsquo;s this about?
              </p>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK_CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={`px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wide transition-all active:scale-95 ${
                      category === c.value
                        ? 'bg-[#003366] text-white shadow-lg'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Free text */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
                Tell us what&rsquo;s on your mind <span className="text-[#E31837]">*</span>
              </p>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
                placeholder="What worked, what didn't, what you'd love to see…"
                rows={5}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 text-sm font-medium text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#E31837]/30 focus:border-[#E31837]/40 resize-none"
              />
              <p className="text-right text-[10px] font-bold text-slate-300 mt-1">
                {body.length}/{MAX_BODY}
              </p>
            </div>

            {error && (
              <p className="text-xs font-bold text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`w-full py-4 rounded-2xl font-black text-base uppercase shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 ${
                canSubmit ? 'bg-[#E31837] text-white' : 'bg-slate-100 text-slate-300 cursor-not-allowed shadow-none'
              }`}
            >
              <Send size={18} /> Submit Feedback
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
