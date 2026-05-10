import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!_client) _client = new Anthropic({ apiKey });
  return _client;
}

export async function askAboutTranscript(opts: {
  transcript: string;
  question: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}): Promise<string> {
  const system = [
    'You are an analyst helping the user understand their email correspondence',
    'with a specific person or company. The user will paste a full transcript',
    'of their conversation history (with attachments transcribed inline) and',
    'then ask questions about it.',
    '',
    'Ground every answer in the transcript. If something is not in the transcript,',
    'say so plainly rather than guessing. Cite specific dates and senders when',
    'they sharpen the answer. Be concise and direct — the user is a busy CEO',
    'who wants the signal, not a recap.',
  ].join('\n');

  const transcriptBlock = `<transcript>\n${opts.transcript}\n</transcript>`;

  const messages: Anthropic.MessageParam[] = [];
  if (opts.history) {
    for (const m of opts.history) messages.push({ role: m.role, content: m.content });
  }
  messages.push({
    role: 'user',
    content: `${transcriptBlock}\n\nQuestion: ${opts.question}`,
  });

  const res = await client().messages.create({
    model,
    max_tokens: 1500,
    system,
    messages,
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return text || '(no response)';
}
