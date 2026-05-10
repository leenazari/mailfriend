// Builds the unified plain-text transcript from cached messages + attachments.
// Used both for the "transcript" view in the UI and as context for the chat API.

export interface MessageRow {
  ref_number: number | null;
  sent_at: string;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  direction: 'incoming' | 'outgoing' | 'other' | null;
  body_text: string | null;
  attachments?: { filename: string; extracted_text: string | null }[];
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  // e.g. "2025-04-12 14:32 UTC"
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

export function buildTranscript(messages: MessageRow[]): string {
  if (messages.length === 0) return '(no messages)';
  const blocks: string[] = [];
  for (const m of messages) {
    const ref = m.ref_number != null ? `#${m.ref_number}` : '#?';
    const dir =
      m.direction === 'outgoing' ? '→ OUT' : m.direction === 'incoming' ? '← IN ' : '·  · ';
    const fromLabel = m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email ?? '?';
    const to = (m.to_emails ?? []).join(', ');
    const cc = (m.cc_emails ?? []).join(', ');
    const header = [
      `── ${ref}  ${dir}  ${fmtDate(m.sent_at)}`,
      `Subject: ${m.subject ?? '(no subject)'}`,
      `From:    ${fromLabel}`,
      `To:      ${to}`,
      cc ? `Cc:      ${cc}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const body = (m.body_text ?? '').trim() || '(empty body)';
    const parts: string[] = [header, '', body];

    if (m.attachments && m.attachments.length > 0) {
      for (const a of m.attachments) {
        parts.push('');
        parts.push(`[attachment: ${a.filename}]`);
        const t = (a.extracted_text ?? '').trim();
        parts.push(t ? t : '(no extractable text)');
      }
    }
    blocks.push(parts.join('\n'));
  }
  return blocks.join('\n\n');
}

/**
 * Trim transcript to a rough character budget. If trimming is required,
 * keep BOTH ends: the earliest messages (often where promises and key
 * commitments live — critical for legal cases) AND the most recent.
 * Drop a chunk from the middle and replace with a marker.
 */
export function trimTranscriptToBudget(transcript: string, maxChars: number): string {
  if (transcript.length <= maxChars) return transcript;

  // 45% to head, 45% to tail, 10% slack for markers + finding block boundaries.
  const halfBudget = Math.floor(maxChars * 0.45);
  const head = transcript.slice(0, halfBudget);
  const tail = transcript.slice(-halfBudget);

  // Snap to the nearest message boundary so we don't cut a message in half.
  const lastBoundaryInHead = head.lastIndexOf('\n\n── ');
  const headClean = lastBoundaryInHead > 0 ? head.slice(0, lastBoundaryInHead) : head;

  const firstBoundaryInTail = tail.indexOf('\n── ');
  const tailClean = firstBoundaryInTail >= 0 ? tail.slice(firstBoundaryInTail + 1) : tail;

  const omittedChars = transcript.length - headClean.length - tailClean.length;
  return (
    headClean +
    `\n\n── … [${omittedChars.toLocaleString()} chars of middle correspondence omitted to fit context] … ──\n\n` +
    tailClean
  );
}
