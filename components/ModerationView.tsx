/**
 * ModerationView — local moderation queue.
 *
 * Lists reported group-chat messages (reporter, text, timestamp, group) with
 * dismiss / remove actions, plus the per-group muted-user lists with unmute.
 * Everything is local-only (localStorage); no backend required.
 */
import React from 'react';
import { X, Flag, Trash2, CheckCircle2, VolumeX, Volume2, ShieldAlert } from 'lucide-react';
import type { CommunityGroup, GroupComment } from '../types';

interface Props {
  comments: GroupComment[];
  groups: CommunityGroup[];
  mutedUsers: Record<string, string[]>;
  onDismiss: (commentId: string) => void;
  onRemove: (commentId: string) => void;
  onUnmute: (groupId: string, userId: string) => void;
  onClose: () => void;
}

export default function ModerationView({ comments, groups, mutedUsers, onDismiss, onRemove, onUnmute, onClose }: Props) {
  const reported = comments.filter((c) => c.reported);
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name || 'Unknown group';
  const userName = (id: string) => comments.find((c) => c.userId === id)?.userName || id;
  const mutedEntries = Object.entries(mutedUsers).filter(([, ids]) => ids.length > 0);

  return (
    <div className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-md flex items-end md:items-center justify-center p-0 md:p-6 animate-fade-in">
      <div className="bg-white w-full max-w-2xl rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-slide-up">
        <div className="p-6 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-orange-50 text-orange-600 rounded-xl"><ShieldAlert size={20} /></div>
            <div>
              <h3 className="text-lg font-black text-slate-900 tracking-tighter uppercase leading-none">Moderation</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Reported messages & muted users</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-slate-900 text-white rounded-xl hover:bg-black"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          <div>
            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
              <Flag size={12} /> Reported messages ({reported.length})
            </h4>
            {reported.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-4 text-center">No reported messages. The community is behaving.</p>
            ) : (
              <div className="space-y-3">
                {reported.map((c) => (
                  <div key={c.id} className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black text-slate-900 uppercase">{groupName(c.groupId)}</p>
                      <span className="text-[8px] font-black uppercase bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Reported</span>
                    </div>
                    <p className="text-xs font-medium text-slate-700 leading-relaxed">"{c.text}"</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase">
                      by {c.userName} • reported by {c.reportedBy === 'me' ? 'you' : (c.reportedBy || 'a member')} • {new Date(c.timestamp).toLocaleString()}
                    </p>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => onDismiss(c.id)}
                        className="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 flex items-center justify-center gap-1.5 hover:border-green-300"
                      >
                        <CheckCircle2 size={13} className="text-green-500" /> Dismiss report
                      </button>
                      <button
                        onClick={() => onRemove(c.id)}
                        className="flex-1 py-2.5 bg-red-50 border border-red-100 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-600 flex items-center justify-center gap-1.5"
                      >
                        <Trash2 size={13} /> Remove message
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
              <VolumeX size={12} /> Muted users
            </h4>
            {mutedEntries.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-4 text-center">No muted users.</p>
            ) : (
              <div className="space-y-2">
                {mutedEntries.map(([groupId, ids]) => (
                  <div key={groupId} className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-slate-900 uppercase mb-2">{groupName(groupId)}</p>
                    <div className="space-y-1.5">
                      {ids.map((uid) => (
                        <div key={uid} className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-600">{userName(uid)} <span className="text-slate-300 font-medium">({uid})</span></span>
                          <button
                            onClick={() => onUnmute(groupId, uid)}
                            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[9px] font-black uppercase text-slate-500 flex items-center gap-1"
                          >
                            <Volume2 size={11} /> Unmute
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
