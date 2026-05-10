import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { buildTranscript, MessageRow, trimTranscriptToBudget } from '@/lib/transcript';
import { askAboutTranscript, estimateCostUsd } from '@/lib/anthropic';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Sonnet 4.6 supports up to ~1M tokens. ~4 chars per token, so ~4M chars
// of total context. We budget 2M chars for the transcript itself (~500k
// tokens) — enough for very large legal histories — and leave headroom
// for the question, chat history, system instructions, and response.
const TRANSCRIPT_BUDGET_CHARS = 2_000_000;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const question = String(body.question ?? '').trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('messages')
      .select(
        'ref_number, sent_at, subject, from_email, from_name, to_emails, cc_emails, direction, body_text, attachments(filename, extracted_text)'
      )
      .eq('sender_group_id', params.id)
      .eq('user_id', user.id)
      .order('sent_at', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const fullTranscript = buildTranscript((data ?? []) as unknown as MessageRow[]);
    const transcript = trimTranscriptToBudget(fullTranscript, TRANSCRIPT_BUDGET_CHARS);

    const result = await askAboutTranscript({
      transcript,
      question,
      history: history
        .filter(
          (m: { role?: string; content?: string }) =>
            (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
        )
        .slice(-10),
    });

    const cost = estimateCostUsd(result.usage);

    return NextResponse.json({
      answer: result.answer,
      truncated: fullTranscript.length > transcript.length,
      transcript_chars: transcript.length,
      total_chars: fullTranscript.length,
      usage: result.usage,
      cost_usd: cost,
    });
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}
