import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!_client) _client = new Anthropic({ apiKey });
  return _client;
}

const SYSTEM_INSTRUCTIONS = [
  'You are an analyst helping the user understand their email correspondence',
  'with a specific person or company. The system prompt below contains the',
  'full transcript of that correspondence (with attachments transcribed inline)',
  'and the user will ask questions about it.',
  '',
  'Ground every answer strictly in the transcript. If something is not in the',
  'transcript, say so plainly rather than guessing. When facts matter — promises',
  'made, dates, response times, specific commitments, what was said and when —',
  'quote the exact text and cite the date and sender. Be concise and direct;',
  'the user is a busy CEO who wants the signal, not a recap.',
  '',
  'When the user is investigating a potential complaint, misselling claim, or',
  'legal case: be a paralegal, not a defender. Surface every promise broken,',
  'every concern that went unaddressed, every unreasonable delay. Quote dates',
  'and exact words. Do not soften.',
].join('\n');

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskResult {
  answer: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}

export async function askAboutTranscript(opts: {
  transcript: string;
  question: string;
  history?: ChatHistoryTurn[];
}): Promise<AskResult> {
  // 1-hour cache TTL — see https://docs.claude.com/en/build-with-claude/prompt-caching
  // The beta header is required to enable the extended TTL. Without it,
  // ttl='1h' silently falls back to the 5-minute default and you pay
  // for cache writes every time the user pauses for >5 minutes.
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: SYSTEM_INSTRUCTIONS },
    {
      type: 'text',
      text: `<transcript>\n${opts.transcript}\n</transcript>`,
      // @ts-expect-error - SDK types may not include ttl yet on all versions
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
  ];

  const messages: Anthropic.MessageParam[] = [];
  if (opts.history) {
    for (const m of opts.history) {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: 'user', content: opts.question });

  const res = await client().messages.create(
    {
      model,
      max_tokens: 1500,
      system,
      messages,
    },
    {
      headers: { 'anthropic-beta': 'extended-cache-ttl-2025-04-11' },
    }
  );

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const usage = res.usage as unknown as {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };

  return {
    answer: text || '(no response)',
    usage: {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    },
  };
}

/**
 * Estimate $ cost from token usage for Sonnet 4.6 with 1-hour cache TTL.
 *
 * Sonnet 4.6 rates (May 2026):
 *   Input:           $3.00 / M
 *   Output:          $15.00 / M
 *   Cache read:      $0.30 / M       (90% off)
 *   Cache write 1h:  $6.00 / M       (2x base — see Anthropic pricing page)
 */
export function estimateCostUsd(usage: AskResult['usage']): number {
  const inCost = (usage.input_tokens / 1_000_000) * 3;
  const outCost = (usage.output_tokens / 1_000_000) * 15;
  const cacheReadCost = (usage.cache_read_input_tokens / 1_000_000) * 0.3;
  const cacheWriteCost = (usage.cache_creation_input_tokens / 1_000_000) * 6;
  return inCost + outCost + cacheReadCost + cacheWriteCost;
}
