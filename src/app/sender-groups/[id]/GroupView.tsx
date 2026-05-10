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
        const parts = [
          `${json.fetched} found`,
          `${json.inserted} new emails`,
          `${json.skipped} already saved`,
        ];
        if (json.pdfs_added > 0) parts.push(`${json.pdfs_added} new PDFs`);
        if (json.pdfs_backfilled > 0) parts.push(`${json.pdfs_backfilled} PDFs backfilled`);
        if (json.errors && json.errors.length > 0) parts.push(`${json.errors.length} errors`);
        setSyncResult(parts.join(' · '));
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
      {tab === 'transcript' && (
        <TranscriptView text={transcript} groupId={group.id} groupName={group.name} />
      )}
      {tab === 'chat' && (
        <ChatView
          groupId={group.id}
          groupName={group.name}
          hasMessages={(messages?.length ?? 0) > 0}
        />
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
                  <summary className="cursor-pointer px-4 py-3 bg-ink-900 hover:bg-ink-800 text-sm flex items-center justify-between gap-4 transition-colors">
                    <span className="font-mono truncate">
                      📎 <Highlight text={a.filename} query={highlight} />
                    </span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-ink-400 font-mono">
                        {a.extracted_text
                          ? `${a.extracted_text.length.toLocaleString()} chars`
                          : 'no extractable text'}
                      </span>
                      <a
                        href={`/api/attachments/${a.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-mono text-accent hover:text-accent-dim px-2 py-1 border border-accent/30 rounded hover:border-accent/60 transition-colors"
                      >
                        open ↗
                      </a>
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

function TranscriptView({
  text,
  groupId,
  groupName,
}: {
  text: string | null;
  groupId: string;
  groupName: string;
}) {
  const [exporting, setExporting] = useState(false);

  if (text === null) return <Empty>Building transcript…</Empty>;
  if (!text || text === '(no messages)')
    return <Empty>No transcript yet — sync first.</Empty>;

  async function exportPdf() {
    if (exporting) return;
    setExporting(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      const usableWidth = pageWidth - margin * 2;
      let y = margin;

      const ensureSpace = (needed: number) => {
        if (y + needed > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
      };

      // Title
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(groupName, margin, y);
      y += 22;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `MailFriend transcript · exported ${new Date().toLocaleString()}`,
        margin,
        y
      );
      doc.setTextColor(0);
      y += 16;
      doc.setDrawColor(150);
      doc.line(margin, y, pageWidth - margin, y);
      y += 16;

      // Split transcript on the "── " separator we emit in transcript.ts.
      const blocks = (text as string).split(/(?=^── )/m).filter((b) => b.trim().length > 0);

      for (const block of blocks) {
        const lines = block.split('\n');
        const headerLine = lines[0]?.startsWith('── ')
          ? lines[0].replace(/^── /, '').replace(/^…/, '… ')
          : null;

        if (headerLine) {
          ensureSpace(40);
          y += 6;
          doc.setDrawColor(200);
          doc.line(margin, y, pageWidth - margin, y);
          y += 12;
          // Date / direction header in bold
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.text(headerLine, margin, y);
          y += 14;

          // Subject / From / To / Cc — use monospace for that "legal log" feel
          doc.setFont('courier', 'normal');
          doc.setFontSize(9);
          let i = 1;
          while (
            i < lines.length &&
            (lines[i].startsWith('Subject:') ||
              lines[i].startsWith('From:') ||
              lines[i].startsWith('To:') ||
              lines[i].startsWith('Cc:'))
          ) {
            const wrapped = doc.splitTextToSize(lines[i], usableWidth);
            for (const w of wrapped) {
              ensureSpace(12);
              doc.text(w, margin, y);
              y += 11;
            }
            i += 1;
          }
          y += 6;

          // Body — normal helvetica
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          for (; i < lines.length; i += 1) {
            const line = lines[i];
            if (line.startsWith('[attachment:')) {
              doc.setFont('helvetica', 'italic');
              doc.setTextColor(120);
              ensureSpace(14);
              y += 4;
              doc.text(line, margin, y);
              y += 12;
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(0);
              continue;
            }
            const wrapped = doc.splitTextToSize(line || ' ', usableWidth);
            for (const w of wrapped) {
              ensureSpace(13);
              doc.text(w, margin, y);
              y += 12;
            }
          }
          y += 6;
        } else {
          // Fallback for any unrecognised block — just dump as text
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          for (const line of lines) {
            const wrapped = doc.splitTextToSize(line || ' ', usableWidth);
            for (const w of wrapped) {
              ensureSpace(13);
              doc.text(w, margin, y);
              y += 12;
            }
          }
        }
      }

      const safeName = groupName.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
      const date = new Date().toISOString().slice(0, 10);
      doc.save(`mailfriend-${safeName}-${date}.pdf`);
    } catch (e) {
      alert(`PDF export failed: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="border border-ink-800 rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-ink-800 bg-ink-900 flex items-center justify-between">
        <div className="text-xs font-mono uppercase tracking-wider text-ink-400">
          {text.length.toLocaleString()} chars
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigator.clipboard.writeText(text)}
            className="text-xs font-mono text-ink-400 hover:text-ink-100"
          >
            copy all
          </button>
          <button
            onClick={exportPdf}
            disabled={exporting}
            className="text-xs font-mono text-accent hover:text-accent-dim disabled:opacity-50"
          >
            {exporting ? 'building…' : 'download as PDF'}
          </button>
        </div>
      </div>
      <pre className="p-5 text-xs font-mono whitespace-pre-wrap leading-relaxed text-ink-200 max-h-[70vh] overflow-y-auto">
        {text}
      </pre>
    </div>
  );
}

// ---------- Chat view (persistent threads) ----------

interface ChatTurn {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  cost_usd?: number;
  cached?: boolean;
  created_at?: string;
}

interface ThreadSummary {
  id: string;
  title: string | null;
  total_cost_usd: number;
  message_count: number;
  created_at: string;
  updated_at: string;
}

function ChatView({
  groupId,
  groupName,
  hasMessages,
}: {
  groupId: string;
  groupName: string;
  hasMessages: boolean;
}) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThreadCost, setActiveThreadCost] = useState(0);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [lastQueryInfo, setLastQueryInfo] = useState<{
    cost: number;
    cached: boolean;
    transcriptChars: number;
    totalChars: number;
  } | null>(null);
  // Selection for evidence export
  const [selectedAssistantIds, setSelectedAssistantIds] = useState<Set<string>>(
    new Set()
  );
  const [exportModalOpen, setExportModalOpen] = useState(false);

  // Load threads list on mount
  async function refreshThreads() {
    try {
      const res = await fetch(`/api/sender-groups/${groupId}/threads`);
      const json = await res.json();
      setThreads(json.threads ?? []);
    } catch {
      /* silent */
    }
  }

  useEffect(() => {
    refreshThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load a specific thread's messages
  async function selectThread(threadId: string) {
    if (threadId === activeThreadId) return;
    setLoadingThread(true);
    setError(null);
    setLastQueryInfo(null);
    setTruncated(false);
    setSelectedAssistantIds(new Set());
    try {
      const res = await fetch(`/api/sender-groups/${groupId}/threads/${threadId}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to load thread.');
      } else {
        setActiveThreadId(threadId);
        setActiveThreadCost(Number(json.thread?.total_cost_usd ?? 0));
        setHistory(
          (json.messages ?? []).map((m: ChatTurn) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            cost_usd: m.cost_usd,
            cached: m.cached,
            created_at: m.created_at,
          }))
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingThread(false);
    }
  }

  function newConversation() {
    setActiveThreadId(null);
    setActiveThreadCost(0);
    setHistory([]);
    setLastQueryInfo(null);
    setTruncated(false);
    setError(null);
    setSelectedAssistantIds(new Set());
  }

  function toggleSelectAnswer(messageId: string) {
    setSelectedAssistantIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  // Walk the history to compute Q/A pair numbers.
  // Each user message increments the counter; the next assistant message
  // gets paired with it.
  const pairNumbers = useMemo(() => {
    const map = new Map<number, number>();
    let n = 0;
    for (let i = 0; i < history.length; i += 1) {
      if (history[i].role === 'user') {
        n += 1;
        map.set(i, n);
      } else {
        map.set(i, n);
      }
    }
    return map;
  }, [history]);

  if (!hasMessages)
    return <Empty>Sync messages first, then ask away.</Empty>;

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setError(null);
    const optimistic: ChatTurn[] = [...history, { role: 'user', content: q }];
    setHistory(optimistic);
    setLoading(true);
    try {
      const res = await fetch(`/api/sender-groups/${groupId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          thread_id: activeThreadId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed.');
        // Roll back optimistic message — server didn't save it.
        setHistory(history);
      } else {
        if (!activeThreadId) setActiveThreadId(json.thread_id);
        setHistory([
          ...optimistic,
          {
            id: json.message_id,
            role: 'assistant',
            content: json.answer,
            cost_usd: json.cost_usd,
            cached: json.cached,
          },
        ]);
        setTruncated(Boolean(json.truncated));
        if (typeof json.cost_usd === 'number') {
          setActiveThreadCost((c) => c + json.cost_usd);
          setLastQueryInfo({
            cost: json.cost_usd,
            cached: Boolean(json.cached),
            transcriptChars: json.transcript_chars ?? 0,
            totalChars: json.total_chars ?? 0,
          });
        }
        // Refresh the threads list to update titles, counts, costs.
        refreshThreads();
      }
    } catch (e) {
      setError((e as Error).message);
      setHistory(history);
    } finally {
      setLoading(false);
    }
  }

  const isNewConversation = !activeThreadId && history.length === 0;
  const activeThread = threads.find((t) => t.id === activeThreadId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
      <div className="border border-ink-800 rounded-lg flex flex-col h-[72vh]">
        {/* Active conversation header */}
        <div className="border-b border-ink-800 px-5 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">
              {activeThread?.title ?? (isNewConversation ? 'New conversation' : 'Conversation')}
            </div>
            {activeThread && (
              <div className="text-xs font-mono text-ink-400 mt-0.5">
                {activeThread.message_count} messages · ${Number(activeThread.total_cost_usd).toFixed(4)}
              </div>
            )}
          </div>
          {!isNewConversation && (
            <button
              onClick={newConversation}
              className="text-xs font-mono text-ink-400 hover:text-ink-100 whitespace-nowrap"
            >
              + new
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loadingThread && (
            <div className="text-xs font-mono text-ink-400">loading conversation…</div>
          )}
          {!loadingThread && history.length === 0 && (
            <div className="text-ink-400 text-sm">
              <div className="mb-3">Try things like:</div>
              <ul className="space-y-1 text-ink-200">
                <li>· What were the last 3 things we agreed on?</li>
                <li>· Build a case assessment: list every promise broken, every concern unaddressed, with dates and exact quotes.</li>
                <li>· Map response times — when I raised issues, how long until they replied, and did they actually address the concern?</li>
                <li>· Pull out the strongest 3-5 pieces of evidence for a misselling claim.</li>
              </ul>
            </div>
          )}
          {history.map((t, i) => {
            const num = pairNumbers.get(i) ?? '?';
            const label = t.role === 'user' ? `Q${num}` : `A${num}`;
            const isSelected = t.id ? selectedAssistantIds.has(t.id) : false;
            return (
              <div key={t.id ?? i} className={t.role === 'user' ? 'text-right' : ''}>
                <div
                  className={`text-xs font-mono mb-1.5 ${
                    t.role === 'user' ? 'text-accent/70' : 'text-ink-400'
                  }`}
                >
                  {label}
                </div>
                <div
                  className={`inline-block max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-left ${
                    t.role === 'user'
                      ? 'bg-accent/15 text-ink-100 border border-accent/30'
                      : 'bg-ink-900 text-ink-100 border border-ink-800'
                  }`}
                >
                  {t.content}
                </div>
                {t.role === 'assistant' && t.id && (
                  <div className="mt-2">
                    <button
                      onClick={() => toggleSelectAnswer(t.id!)}
                      className={`text-xs font-mono px-2.5 py-1 rounded transition-colors ${
                        isSelected
                          ? 'bg-accent/20 text-accent border border-accent/50'
                          : 'text-ink-400 hover:text-ink-100 border border-ink-700 hover:border-ink-500'
                      }`}
                    >
                      {isSelected
                        ? `✓ in evidence pack (A${num})`
                        : `+ add A${num} to evidence`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {loading && (
            <div className="text-xs font-mono text-ink-400">thinking…</div>
          )}
          {error && (
            <div className="text-sm text-red-400 border border-red-400/30 bg-red-400/5 rounded px-4 py-2">
              {error}
            </div>
          )}
        </div>
        {selectedAssistantIds.size > 0 && (
          <div className="border-t border-ink-800 px-4 py-2.5 bg-accent/10 flex items-center justify-between gap-3">
            <span className="text-xs text-ink-200 font-mono">
              {selectedAssistantIds.size} answer
              {selectedAssistantIds.size === 1 ? '' : 's'} selected
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedAssistantIds(new Set())}
                className="text-xs font-mono text-ink-400 hover:text-ink-100"
              >
                clear
              </button>
              <button
                onClick={() => setExportModalOpen(true)}
                className="text-xs bg-accent hover:bg-accent-dim text-ink-950 font-medium px-3 py-1.5 rounded transition-colors"
              >
                Export evidence pack →
              </button>
            </div>
          </div>
        )}
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
        {/* Conversations */}
        <div className="border border-ink-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-800 bg-ink-900 flex items-center justify-between">
            <div className="text-xs font-mono uppercase tracking-wider text-ink-400">
              Conversations
            </div>
            <button
              onClick={newConversation}
              className="text-xs font-mono text-accent hover:text-accent-dim"
            >
              + new
            </button>
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {threads.length === 0 ? (
              <div className="px-4 py-6 text-xs text-ink-400 text-center">
                No conversations yet. Ask a question to start one.
              </div>
            ) : (
              <div className="divide-y divide-ink-800">
                {threads.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => selectThread(t.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-ink-900 transition-colors ${
                      t.id === activeThreadId ? 'bg-ink-900 border-l-2 border-accent' : ''
                    }`}
                  >
                    <div className="text-sm truncate font-medium">
                      {t.title ?? '(untitled)'}
                    </div>
                    <div className="text-xs font-mono text-ink-400 mt-1 flex items-center gap-2">
                      <span>{relativeTime(t.updated_at)}</span>
                      <span>·</span>
                      <span>{t.message_count} msg</span>
                      <span>·</span>
                      <span>${Number(t.total_cost_usd).toFixed(3)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cost meter */}
        <div className="border border-ink-800 rounded-lg p-4">
          <div className="text-xs font-mono uppercase tracking-wider text-ink-400 mb-3">
            This conversation
          </div>
          <div className="text-3xl font-medium tracking-tight tabular-nums">
            ${activeThreadCost.toFixed(4)}
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

      {exportModalOpen && (
        <ExportEvidenceModal
          groupId={groupId}
          groupName={groupName}
          history={history}
          pairNumbers={pairNumbers}
          selectedAssistantIds={selectedAssistantIds}
          onClose={() => setExportModalOpen(false)}
        />
      )}
    </div>
  );
}

// ---------- Evidence export modal ----------

interface PdfMetadata {
  id: string;
  filename: string;
  message_ref: number | null;
  message_subject: string | null;
  message_date: string;
}

function ExportEvidenceModal({
  groupId,
  groupName,
  history,
  pairNumbers,
  selectedAssistantIds,
  onClose,
}: {
  groupId: string;
  groupName: string;
  history: ChatTurn[];
  pairNumbers: Map<number, number>;
  selectedAssistantIds: Set<string>;
  onClose: () => void;
}) {
  const [loadingPdfs, setLoadingPdfs] = useState(true);
  const [availablePdfs, setAvailablePdfs] = useState<PdfMetadata[]>([]);
  const [pdfSelection, setPdfSelection] = useState<Set<string>>(new Set());
  const [recommended, setRecommended] = useState<Set<string>>(new Set());
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve Q/A pairs from the selected assistant message IDs.
  const selectedPairs = useMemo(() => {
    const pairs: Array<{ q: string; a: string; number: number }> = [];
    for (let i = 0; i < history.length; i += 1) {
      const t = history[i];
      if (t.role !== 'assistant' || !t.id || !selectedAssistantIds.has(t.id)) continue;
      const num = pairNumbers.get(i) ?? 0;
      // Find the most recent preceding user message
      let q = '(question missing)';
      for (let j = i - 1; j >= 0; j -= 1) {
        if (history[j].role === 'user') {
          q = history[j].content;
          break;
        }
      }
      pairs.push({ q, a: t.content, number: num });
    }
    return pairs.sort((a, b) => a.number - b.number);
  }, [history, pairNumbers, selectedAssistantIds]);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !building) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, building]);

  // Body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Fetch AI-suggested PDFs
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingPdfs(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/sender-groups/${groupId}/evidence/suggest-pdfs`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              answer_texts: selectedPairs.map((p) => p.a),
            }),
          }
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? 'Failed to load PDFs.');
        } else {
          const pdfs: PdfMetadata[] = json.available_pdfs ?? [];
          const rec: string[] = json.recommended_pdf_ids ?? [];
          setAvailablePdfs(pdfs);
          setRecommended(new Set(rec));
          setPdfSelection(new Set(rec));
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoadingPdfs(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePdf(id: string) {
    setPdfSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function downloadEvidencePack() {
    if (building) return;
    setBuilding(true);
    setError(null);
    try {
      setProgress('Building evidence summary…');
      const selectedPdfs = availablePdfs.filter((p) => pdfSelection.has(p.id));
      const blob = await buildEvidenceZip({
        groupName,
        qaPairs: selectedPairs,
        selectedPdfs,
        onProgress: setProgress,
      });
      const safeName = groupName.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
      const date = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mailfriend-evidence-${safeName}-${date}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setProgress('Done.');
      setTimeout(() => onClose(), 500);
    } catch (e) {
      setError((e as Error).message);
      setBuilding(false);
      setProgress(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => !building && onClose()}
      />
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-ink-950 border border-ink-800 rounded-xl overflow-hidden flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b border-ink-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium tracking-tight">Export evidence pack</h2>
            <p className="text-xs text-ink-400 mt-0.5">
              {groupName} · {selectedPairs.length} answer{selectedPairs.length === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={() => !building && onClose()}
            disabled={building}
            className="text-ink-400 hover:text-ink-100 text-2xl leading-none w-8 h-8 flex items-center justify-center disabled:opacity-30"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <section>
            <div className="text-xs font-mono uppercase tracking-wider text-ink-400 mb-3">
              Included Q&amp;A pairs
            </div>
            <div className="space-y-2">
              {selectedPairs.map((p) => (
                <div
                  key={p.number}
                  className="border border-ink-800 rounded-md px-3 py-2 text-sm"
                >
                  <div className="font-mono text-xs text-accent mb-1">Q{p.number}</div>
                  <div className="text-ink-200 line-clamp-2">{p.q}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-mono uppercase tracking-wider text-ink-400">
                Supporting documents
              </div>
              {!loadingPdfs && availablePdfs.length > 0 && (
                <div className="text-xs font-mono text-ink-400">
                  {pdfSelection.size} of {availablePdfs.length} selected
                </div>
              )}
            </div>
            {loadingPdfs ? (
              <div className="text-sm text-ink-400 border border-dashed border-ink-700 rounded-md p-6 text-center">
                Claude is reviewing which PDFs to include as evidence…
              </div>
            ) : availablePdfs.length === 0 ? (
              <div className="text-sm text-ink-400 border border-dashed border-ink-700 rounded-md p-6 text-center">
                No PDFs found in this correspondence.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {availablePdfs.map((p) => {
                  const checked = pdfSelection.has(p.id);
                  const isRecommended = recommended.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className={`flex items-start gap-3 px-3 py-2.5 rounded-md border cursor-pointer transition-colors ${
                        checked
                          ? 'border-accent/50 bg-accent/5'
                          : 'border-ink-800 hover:border-ink-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePdf(p.id)}
                        className="mt-0.5 accent-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-mono truncate">{p.filename}</span>
                          {isRecommended && (
                            <span className="text-[10px] font-mono uppercase tracking-wider bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                              recommended
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-ink-400 mt-0.5 truncate">
                          from email #{p.message_ref ?? '?'} ·{' '}
                          {new Date(p.message_date).toLocaleDateString()} ·{' '}
                          {p.message_subject ?? '(no subject)'}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          {progress && (
            <div className="text-xs font-mono text-ink-200 border border-ink-800 rounded-md p-3 bg-ink-900">
              {progress}
            </div>
          )}
          {error && (
            <div className="text-sm text-red-400 border border-red-400/30 bg-red-400/5 rounded-md p-3">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-ink-800 px-6 py-4 flex items-center justify-between">
          <div className="text-xs text-ink-400">
            Generates a zip with a PDF of the selected Q&amp;A pairs plus all
            checked supporting documents.
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => !building && onClose()}
              disabled={building}
              className="text-sm text-ink-400 hover:text-ink-100 disabled:opacity-30"
            >
              Cancel
            </button>
            <button
              onClick={downloadEvidencePack}
              disabled={building || selectedPairs.length === 0}
              className="bg-accent hover:bg-accent-dim disabled:opacity-50 text-ink-950 font-medium px-5 py-2 rounded-md text-sm transition-colors"
            >
              {building ? 'Building…' : 'Download evidence pack'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Evidence pack builder ----------

async function buildEvidenceZip(opts: {
  groupName: string;
  qaPairs: Array<{ q: string; a: string; number: number }>;
  selectedPdfs: PdfMetadata[];
  onProgress?: (msg: string) => void;
}): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const JSZipMod = await import('jszip');
  const JSZip = JSZipMod.default;

  opts.onProgress?.('Building evidence summary…');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 50;
  const usableWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Cover header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('Evidence Pack', margin, y + 20);
  y += 56;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.text(opts.groupName, margin, y);
  y += 28;

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `Prepared ${new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })} · Generated by MailFriend`,
    margin,
    y
  );
  doc.setTextColor(0);
  y += 24;

  doc.setFontSize(10);
  doc.text(`Contents:`, margin, y);
  y += 14;
  doc.text(`• ${opts.qaPairs.length} Q&A pair${opts.qaPairs.length === 1 ? '' : 's'} from investigation`, margin + 10, y);
  y += 13;
  doc.text(
    `• ${opts.selectedPdfs.length} supporting document${opts.selectedPdfs.length === 1 ? '' : 's'}`,
    margin + 10,
    y
  );
  y += 30;

  for (const pair of opts.qaPairs) {
    ensureSpace(80);
    doc.setDrawColor(180);
    doc.line(margin, y, pageWidth - margin, y);
    y += 18;

    // Question header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(150);
    doc.text(`QUESTION ${pair.number}`, margin, y);
    doc.setTextColor(0);
    y += 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    for (const line of pair.q.split('\n')) {
      const wrapped = doc.splitTextToSize(line || ' ', usableWidth);
      for (const w of wrapped) {
        ensureSpace(14);
        doc.text(w, margin, y);
        y += 14;
      }
    }
    y += 12;

    ensureSpace(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(150);
    doc.text(`ANSWER ${pair.number}`, margin, y);
    doc.setTextColor(0);
    y += 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    for (const line of pair.a.split('\n')) {
      const wrapped = doc.splitTextToSize(line || ' ', usableWidth);
      for (const w of wrapped) {
        ensureSpace(14);
        doc.text(w, margin, y);
        y += 14;
      }
    }
    y += 24;
  }

  if (opts.selectedPdfs.length > 0) {
    doc.addPage();
    y = margin;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Attached evidence', margin, y);
    y += 22;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    for (const pdf of opts.selectedPdfs) {
      const date = new Date(pdf.message_date).toLocaleDateString();
      const line = `• ${pdf.filename} — from email #${pdf.message_ref ?? '?'} (${date})`;
      const wrapped = doc.splitTextToSize(line, usableWidth);
      for (const w of wrapped) {
        ensureSpace(14);
        doc.text(w, margin, y);
        y += 13;
      }
    }
  }

  // Page numbers
  // @ts-expect-error - getNumberOfPages exists at runtime on jsPDF
  const totalPages: number = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Page ${i} of ${totalPages}`,
      pageWidth - margin,
      pageHeight - 20,
      { align: 'right' }
    );
    doc.setTextColor(0);
  }

  const pdfBlob = doc.output('blob');

  // Bundle into a zip
  const zip = new JSZip();
  zip.file('Evidence Summary.pdf', pdfBlob);

  if (opts.selectedPdfs.length > 0) {
    const folder = zip.folder('Supporting Documents');
    if (folder) {
      for (let i = 0; i < opts.selectedPdfs.length; i += 1) {
        const att = opts.selectedPdfs[i];
        opts.onProgress?.(
          `Fetching ${att.filename} (${i + 1}/${opts.selectedPdfs.length})…`
        );
        try {
          const res = await fetch(`/api/attachments/${att.id}`);
          if (res.ok) {
            const blob = await res.blob();
            // Prefix with the email ref number so attachments group naturally.
            const ref = att.message_ref ?? '?';
            const safeName = att.filename.replace(/[/\\]/g, '_');
            folder.file(`${String(ref).padStart(3, '0')}-${safeName}`, blob);
          }
        } catch (err) {
          console.warn(`Failed to fetch ${att.filename}:`, err);
        }
      }
    }
  }

  opts.onProgress?.('Compressing…');
  return await zip.generateAsync({ type: 'blob' });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
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
