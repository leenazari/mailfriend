'use client';

import { useEffect, useState } from 'react';

interface Group {
  id: string;
  name: string;
  description: string | null;
  email_addresses: string[];
  last_synced_at: string | null;
}

interface MessageRow {
  id: string;
  ref_number: number | null;
  sent_at: string;
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  direction: 'incoming' | 'outgoing' | 'other' | null;
  snippet: string | null;
  attachments: { id: string; filename: string }[];
}

type Tab = 'log' | 'transcript' | 'chat';

export default function GroupView({ group: initialGroup }: { group: Group }) {
  const [group, setGroup] = useState(initialGroup);
  const [tab, setTab] = useState<Tab>('log');
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  async function loadMessages() {
    const res = await fetch(`/api/sender-groups/${group.id}/messages`);
    const json = await res.json();
    setMessages(json.messages ?? []);
  }
  async function loadTranscript() {
    const res = await fetch(`/api/sender-groups/${group.id}/transcript`);
    const text = await res.text();
    setTranscript(text);
  }

  useEffect(() => {
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === 'transcript' && transcript === null) loadTranscript();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function runSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`/api/sender-groups/${group.id}/sync`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setSyncResult(`Error: ${json.error ?? 'unknown'}`);
      } else {
        setSyncResult(
          `Found ${json.fetched} · added ${json.inserted} · skipped ${json.skipped} · ${json.pdfs} PDFs`
        );
        setGroup({ ...group, last_synced_at: new Date().toISOString() });
        await loadMessages();
        setTranscript(null); // force reload next time the tab opens
      }
    } catch (e) {
      setSyncResult(`Error: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="max-w-6xl mx-auto px-8 py-10">
      {/* Group header */}
      <div className="flex items-start justify-between gap-6 mb-8">
        <div className="min-w-0">
          <h1 className="text-3xl font-medium tracking-tight">{group.name}</h1>
          {group.description && (
            <p className="text-ink-400 text-sm mt-1">{group.description}</p>
          )}
          <div className="font-mono text-xs text-ink-400 mt-3">
            {group.email_addresses.join(' · ')}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={runSync}
            disabled={syncing}
            className="bg-accent hover:bg-accent-dim disabled:opacity-50 text-ink-950 font-medium px-4 py-2 rounded-md text-sm transition-colors"
          >
            {syncing ? 'Syncing…' : group.last_synced_at ? 'Re-sync' : 'Sync now'}
          </button>
          <div className="text-xs font-mono text-ink-400">
            {group.last_synced_at
              ? `last sync: ${new Date(group.last_synced_at).toLocaleString()}`
              : 'never synced'}
          </div>
          {syncResult && (
            <div className="text-xs font-mono text-ink-200 max-w-xs text-right">{syncResult}</div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-ink-800 flex gap-6 mb-6">
        {(['log', 'transcript', 'chat'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-3 text-sm font-medium tracking-tight transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-accent text-ink-100'
                : 'border-transparent text-ink-400 hover:text-ink-100'
            }`}
          >
            {t === 'log' ? 'Catalog' : t === 'transcript' ? 'Transcript' : 'Ask AI'}
          </button>
        ))}
      </div>

      {tab === 'log' && <LogView messages={messages} />}
      {tab === 'transcript' && <TranscriptView text={transcript} />}
      {tab === 'chat' && (
        <ChatView groupId={group.id} hasMessages={(messages?.length ?? 0) > 0} />
      )}
    </section>
  );
}

// ---------- Log view ----------

function LogView({ messages }: { messages: MessageRow[] | null }) {
  if (messages === null) return <Empty>Loading…</Empty>;
  if (messages.length === 0)
    return (
      <Empty>
        No messages yet. Hit <span className="text-accent">Sync now</span> to pull
        them from Gmail.
      </Empty>
    );

  return (
    <div className="border border-ink-800 rounded-lg overflow-hidden">
      <div className="grid grid-cols-[60px_180px_90px_minmax(0,1fr)_minmax(0,1.2fr)_80px] gap-4 px-4 py-3 text-xs font-mono uppercase tracking-wider text-ink-400 border-b border-ink-800 bg-ink-900">
        <div>#</div>
        <div>When</div>
        <div>Dir</div>
        <div>From</div>
        <div>Subject</div>
        <div className="text-right">PDFs</div>
      </div>
      <div className="divide-y divide-ink-800">
        {messages.map((m) => (
          <div
            key={m.id}
            className="grid grid-cols-[60px_180px_90px_minmax(0,1fr)_minmax(0,1.2fr)_80px] gap-4 px-4 py-3 text-sm hover:bg-ink-900 transition-colors"
          >
            <div className="font-mono text-ink-400">#{m.ref_number ?? '?'}</div>
            <div className="font-mono text-xs text-ink-200">{fmtDateTime(m.sent_at)}</div>
            <div>
              <DirBadge dir={m.direction} />
            </div>
            <div className="truncate" title={m.from_email ?? ''}>
              {m.from_name ?? m.from_email ?? '?'}
              <span className="text-ink-400 text-xs ml-2">{m.from_email}</span>
            </div>
            <div className="truncate text-ink-100" title={m.subject ?? ''}>
              {m.subject ?? '(no subject)'}
              {m.snippet && (
                <div className="text-xs text-ink-400 truncate">{m.snippet}</div>
              )}
            </div>
            <div className="text-right text-xs font-mono text-ink-400">
              {m.attachments.length > 0 ? `${m.attachments.length} pdf` : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DirBadge({ dir }: { dir: MessageRow['direction'] }) {
  if (dir === 'outgoing')
    return <span className="font-mono text-xs text-accent">→ OUT</span>;
  if (dir === 'incoming')
    return <span className="font-mono text-xs text-ink-100">← IN</span>;
  return <span className="font-mono text-xs text-ink-400">· · ·</span>;
}

// ---------- Transcript view ----------

function TranscriptView({ text }: { text: string | null }) {
  if (text === null) return <Empty>Building transcript…</Empty>;
  if (!text || text === '(no messages)')
    return <Empty>No transcript yet — sync first.</Empty>;
  return (
    <div className="border border-ink-800 rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-ink-800 bg-ink-900 flex items-center justify-between">
        <div className="text-xs font-mono uppercase tracking-wider text-ink-400">
          {text.length.toLocaleString()} chars
        </div>
        <button
          onClick={() => navigator.clipboard.writeText(text)}
          className="text-xs font-mono text-ink-400 hover:text-ink-100"
        >
          copy all
        </button>
      </div>
      <pre className="p-5 text-xs font-mono whitespace-pre-wrap leading-relaxed text-ink-200 max-h-[70vh] overflow-y-auto">
        {text}
      </pre>
    </div>
  );
}

// ---------- Chat view ----------

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

function ChatView({ groupId, hasMessages }: { groupId: string; hasMessages: boolean }) {
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  if (!hasMessages)
    return <Empty>Sync messages first, then ask away.</Empty>;

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setError(null);
    const newHistory: ChatTurn[] = [...history, { role: 'user', content: q }];
    setHistory(newHistory);
    setLoading(true);
    try {
      const res = await fetch(`/api/sender-groups/${groupId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, history }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed.');
      } else {
        setHistory([...newHistory, { role: 'assistant', content: json.answer }]);
        setTruncated(Boolean(json.truncated));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      <div className="border border-ink-800 rounded-lg flex flex-col h-[70vh]">
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {history.length === 0 && (
            <div className="text-ink-400 text-sm">
              Try things like:
              <ul className="mt-2 space-y-1 text-ink-200">
                <li>· What were the last 3 things we agreed on?</li>
                <li>· Summarize the contract negotiation in 5 bullets.</li>
                <li>· Were any deadlines mentioned, and have they passed?</li>
                <li>· What numbers did they quote me, and when?</li>
              </ul>
            </div>
          )}
          {history.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'text-right' : ''}>
              <div
                className={`inline-block max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  t.role === 'user'
                    ? 'bg-accent/15 text-ink-100 border border-accent/30'
                    : 'bg-ink-900 text-ink-100 border border-ink-800'
                }`}
              >
                {t.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="text-xs font-mono text-ink-400">thinking…</div>
          )}
          {error && (
            <div className="text-sm text-red-400 border border-red-400/30 bg-red-400/5 rounded px-4 py-2">
              {error}
            </div>
          )}
        </div>
        <div className="border-t border-ink-800 p-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask anything about this correspondence…"
            disabled={loading}
            className="flex-1 bg-ink-900 border border-ink-700 focus:border-accent rounded-md px-4 py-2.5 outline-none text-sm transition-colors"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="bg-accent hover:bg-accent-dim disabled:opacity-50 text-ink-950 font-medium px-5 py-2.5 rounded-md text-sm transition-colors"
          >
            Ask
          </button>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="border border-ink-800 rounded-lg p-4">
          <div className="text-xs font-mono uppercase tracking-wider text-ink-400 mb-2">
            How it works
          </div>
          <p className="text-xs text-ink-200 leading-relaxed">
            The full transcript is sent to Claude with your question. Answers are
            grounded in what's in your inbox — if it's not there, Claude says so.
          </p>
        </div>
        {truncated && (
          <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-amber-400 mb-2">
              Truncated
            </div>
            <p className="text-xs text-ink-200 leading-relaxed">
              The transcript was too long for one prompt. The most recent portion
              was used. For huge histories, add an embedding step in v2.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

// ---------- shared bits ----------

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-ink-700 rounded-lg p-12 text-center text-ink-400 text-sm">
      {children}
    </div>
  );
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
