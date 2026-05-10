'use client';

import { useEffect, useMemo, useState } from 'react';

interface Group {
  id: string;
  name: string;
  description: string | null;
  email_addresses: string[];
  last_synced_at: string | null;
}

interface Attachment {
  id: string;
  filename: string;
  extracted_text: string | null;
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
  body_text: string | null;
  attachments: Attachment[];
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
        setTranscript(null);
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
  const [query, setQuery] = useState('');
  const [openMessage, setOpenMessage] = useState<MessageRow | null>(null);

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!messages) return [];
    if (!q) return messages;
    return messages.filter((m) => {
      const haystack = [
        m.subject ?? '',
        m.from_name ?? '',
        m.from_email ?? '',
        m.snippet ?? '',
        m.body_text ?? '',
        (m.to_emails ?? []).join(' '),
        (m.cc_emails ?? []).join(' '),
        ...m.attachments.map((a) => `${a.filename} ${a.extracted_text ?? ''}`),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [messages, q]);

  if (messages === null) return <Empty>Loading…</Empty>;
  if (messages.length === 0)
    return (
      <Empty>
        No messages yet. Hit <span className="text-accent">Sync now</span> to pull
        them from Gmail.
      </Empty>
    );

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search subject, body, sender, attachments…"
            className="w-full bg-ink-900 border border-ink-700 focus:border-accent rounded-md pl-10 pr-10 py-2.5 outline-none text-sm transition-colors"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3-3" />
          </svg>
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-100 text-xs font-mono"
            >
              clear
            </button>
          )}
        </div>
        <div className="text-xs text-ink-400 font-mono shrink-0">
          {filtered.length} of {messages.length}
        </div>
      </div>

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
          {filtered.map((m) => (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              onClick={() => setOpenMessage(m)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenMessage(m);
                }
              }}
              className="grid grid-cols-[60px_180px_90px_minmax(0,1fr)_minmax(0,1.2fr)_80px] gap-4 px-4 py-3 text-sm hover:bg-ink-900 cursor-pointer transition-colors outline-none focus:bg-ink-900"
            >
              <div className="font-mono text-ink-400">#{m.ref_number ?? '?'}</div>
              <div className="font-mono text-xs text-ink-200">{fmtDateTime(m.sent_at)}</div>
              <div>
                <DirBadge dir={m.direction} />
              </div>
              <div className="truncate" title={m.from_email ?? ''}>
                <Highlight text={m.from_name ?? m.from_email ?? '?'} query={q} />
                <span className="text-ink-400 text-xs ml-2">
                  <Highlight text={m.from_email ?? ''} query={q} />
                </span>
              </div>
              <div className="truncate text-ink-100" title={m.subject ?? ''}>
                <Highlight text={m.subject ?? '(no subject)'} query={q} />
                {m.snippet && (
                  <div className="text-xs text-ink-400 truncate">
                    <Highlight text={m.snippet} query={q} />
                  </div>
                )}
              </div>
              <div className="text-right text-xs font-mono text-ink-400">
                {m.attachments.length > 0 ? `${m.attachments.length} pdf` : '—'}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-12 text-center text-ink-400 text-sm">
              No matches for &ldquo;{query}&rdquo;.
            </div>
          )}
        </div>
      </div>

      {openMessage && (
        <MessageDetail
          message={openMessage}
          onClose={() => setOpenMessage(null)}
          highlight={q}
        />
      )}
    </>
  );
}

// ---------- Message detail panel ----------

function MessageDetail({
  message,
  onClose,
  highlight,
}: {
  message: MessageRow;
  onClose: () => void;
  highlight: string;
}) {
  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-3xl bg-ink-950 border-l border-ink-800 overflow-y-auto shadow-2xl">
        <div className="sticky top-0 z-10 bg-ink-950/95 backdrop-blur border-b border-ink-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 font-mono text-xs text-ink-400">
            <span className="text-ink-200">#{message.ref_number ?? '?'}</span>
            <span>·</span>
            <span>{fmtDateTime(message.sent_at)}</span>
            <span>·</span>
            <DirBadge dir={message.direction} />
          </div>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-100 text-3xl leading-none w-8 h-8 flex items-center justify-center"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          <h2 className="text-2xl font-medium tracking-tight mb-5 leading-tight">
            <Highlight text={message.subject ?? '(no subject)'} query={highlight} />
          </h2>

          <div className="text-sm space-y-1.5 mb-6 font-mono text-ink-200 border-l-2 border-ink-700 pl-4">
            <div>
              <span className="text-ink-400 inline-block w-12">From:</span>
              {message.from_name && (
                <Highlight text={`${message.from_name} `} query={highlight} />
              )}
              <span className="text-ink-400">
                &lt;<Highlight text={message.from_email ?? ''} query={highlight} />&gt;
              </span>
            </div>
            <div>
              <span className="text-ink-400 inline-block w-12">To:</span>
              <Highlight text={(message.to_emails ?? []).join(', ')} query={highlight} />
            </div>
            {message.cc_emails && message.cc_emails.length > 0 && (
              <div>
                <span className="text-ink-400 inline-block w-12">Cc:</span>
                <Highlight text={message.cc_emails.join(', ')} query={highlight} />
              </div>
            )}
          </div>

          <div className="whitespace-pre-wrap text-sm text-ink-100 leading-relaxed">
            <Highlight text={message.body_text ?? '(empty body)'} query={highlight} />
          </div>

          {message.attachments.length > 0 && (
            <div className="mt-10 space-y-3">
              <div className="text-xs font-mono uppercase tracking-wider text-ink-400">
                Attachments ({message.attachments.length})
              </div>
              {message.attachments.map((a) => (
                <details
                  key={a.id}
                  className="border border-ink-800 rounded-lg overflow-hidden"
                >
                  <summary className="cursor-pointer px-4 py-3 bg-ink-900 hover:bg-ink-800 text-sm flex items-center justify-between transition-colors">
                    <span className="font-mono">
                      📎 <Highlight text={a.filename} query={highlight} />
                    </span>
                    <span className="text-xs text-ink-400 font-mono">
                      {a.extracted_text
                        ? `${a.extracted_text.length.toLocaleString()} chars`
                        : 'no extractable text'}
                    </span>
                  </summary>
                  {a.extracted_text && (
                    <div className="p-4 text-xs font-mono whitespace-pre-wrap text-ink-200 max-h-96 overflow-y-auto border-t border-ink-800 leading-relaxed">
                      <Highlight text={a.extracted_text} query={highlight} />
                    </div>
                  )}
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Highlight helper ----------

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(re);
  const lower = query.toLowerCase();
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === lower ? (
          <mark
            key={i}
            className="bg-accent/30 text-accent rounded px-0.5 py-px"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
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
  const [sessionCost, setSessionCost] = useState(0);
  const [lastQueryInfo, setLastQueryInfo] = useState<{
    cost: number;
    cached: boolean;
    transcriptChars: number;
    totalChars: number;
  } | null>(null);

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
        if (typeof json.cost_usd === 'number') {
          setSessionCost((c) => c + json.cost_usd);
          setLastQueryInfo({
            cost: json.cost_usd,
            cached: (json.usage?.cache_read_input_tokens ?? 0) > 0,
            transcriptChars: json.transcript_chars ?? 0,
            totalChars: json.total_chars ?? 0,
          });
        }
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
                className={`inline-block max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-left ${
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
          <div className="text-xs font-mono uppercase tracking-wider text-ink-400 mb-3">
            Session cost
          </div>
          <div className="text-3xl font-medium tracking-tight tabular-nums">
            ${sessionCost.toFixed(4)}
          </div>
          <div className="text-xs text-ink-400 mt-1">
            {history.filter((t) => t.role === 'user').length} question
            {history.filter((t) => t.role === 'user').length === 1 ? '' : 's'} this session
          </div>
          {lastQueryInfo && (
            <div className="mt-4 pt-4 border-t border-ink-800 space-y-1.5 text-xs font-mono">
              <div className="flex justify-between text-ink-400">
                <span>last query</span>
                <span className="text-ink-200">${lastQueryInfo.cost.toFixed(4)}</span>
              </div>
              <div className="flex justify-between text-ink-400">
                <span>cache hit</span>
                <span className={lastQueryInfo.cached ? 'text-accent' : 'text-ink-200'}>
                  {lastQueryInfo.cached ? 'yes (90% off)' : 'no (cold)'}
                </span>
              </div>
              <div className="flex justify-between text-ink-400">
                <span>transcript</span>
                <span className="text-ink-200">
                  {(lastQueryInfo.transcriptChars / 1000).toFixed(0)}k chars
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="border border-ink-800 rounded-lg p-4">
          <div className="text-xs font-mono uppercase tracking-wider text-ink-400 mb-2">
            How it works
          </div>
          <p className="text-xs text-ink-200 leading-relaxed">
            The full transcript is sent to Claude with your question. Answers are
            grounded in what&apos;s in your inbox — if it&apos;s not there, Claude says so.
            Follow-up questions reuse a cached transcript and are ~90% cheaper.
          </p>
        </div>

        {truncated && (
          <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-4">
            <div className="text-xs font-mono uppercase tracking-wider text-amber-400 mb-2">
              Trimmed to fit
            </div>
            <p className="text-xs text-ink-200 leading-relaxed">
              Transcript was larger than the budget. Both the earliest and most
              recent messages were kept; the middle section was dropped.
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
