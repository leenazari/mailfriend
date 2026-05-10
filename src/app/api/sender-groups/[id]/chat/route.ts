import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { buildTranscript, MessageRow, trimTranscriptToBudget } from '@/lib/transcript';
import { askAboutTranscript } from '@/lib/anthropic';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Roughly 4 chars per token. Sonnet 4.6 has a large context but
// keep transcript under ~150k chars (~37k tokens) to leave room
// for the question, history, and answer.
const TRANSCRIPT_BUDGET_CHARS = 150_000;

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

    const answer = await askAboutTranscript({
      transcript,
      question,
      history: history
        .filter(
          (m: { role?: string; content?: string }) =>
            (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
        )
        .slice(-10), // keep recent turns only
    });

    return NextResponse.json({ answer, truncated: fullTranscript.length > transcript.length });
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}
