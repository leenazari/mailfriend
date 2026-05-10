import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { buildTranscript, MessageRow, trimTranscriptToBudget } from '@/lib/transcript';
import {
  askAboutTranscript,
  estimateCostUsd,
  type ChatHistoryTurn,
} from '@/lib/anthropic';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Sonnet 4.6 has a 1M token context window. ~4 chars per token = ~4M chars total.
// We budget 3.6M chars (~900k tokens) for the transcript, leaving ~100k tokens
// for system instructions, chat history, the question, and the response.
// For any realistic legal-investigation correspondence (even thousands of long
// emails) this is effectively no limit — trim is a safety net, not a constraint.
const TRANSCRIPT_BUDGET_CHARS = 3_600_000;

/**
 * POST body:
 *   {
 *     question: string,
 *     thread_id?: string   // omit to auto-create a new thread
 *   }
 *
 * Response:
 *   {
 *     thread_id, answer, truncated, transcript_chars, total_chars,
 *     usage, cost_usd, message_id
 *   }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const question = String(body.question ?? '').trim();
    let threadId: string | null = body.thread_id ? String(body.thread_id) : null;
    if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });

    // Group must belong to this user.
    const { data: group } = await supabaseAdmin
      .from('sender_groups')
      .select('id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();
    if (!group) return NextResponse.json({ error: 'group not found' }, { status: 404 });

    // If no thread, create one — title from first 80 chars of the question.
    if (!threadId) {
      const title = question.slice(0, 80) + (question.length > 80 ? '…' : '');
      const { data: newThread, error: newErr } = await supabaseAdmin
        .from('chat_threads')
        .insert({ sender_group_id: params.id, user_id: user.id, title })
        .select('id')
        .single();
      if (newErr || !newThread)
        return NextResponse.json(
          { error: newErr?.message ?? 'thread create failed' },
          { status: 500 }
        );
      threadId = newThread.id;
    } else {
      // Verify the thread belongs to this user + group.
      const { data: t } = await supabaseAdmin
        .from('chat_threads')
        .select('id')
        .eq('id', threadId)
        .eq('sender_group_id', params.id)
        .eq('user_id', user.id)
        .single();
      if (!t) return NextResponse.json({ error: 'thread not found' }, { status: 404 });
    }

    // Load prior history from DB so the server is source of truth.
    const { data: prior, error: priorErr } = await supabaseAdmin
      .from('chat_messages')
      .select('role, content, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    if (priorErr) return NextResponse.json({ error: priorErr.message }, { status: 500 });

    const history: ChatHistoryTurn[] = (prior ?? [])
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      .slice(-10);

    // Persist user message FIRST so it's safe even if AI call fails.
    const { error: userMsgErr } = await supabaseAdmin
      .from('chat_messages')
      .insert({ thread_id: threadId, role: 'user', content: question });
    if (userMsgErr)
      return NextResponse.json({ error: userMsgErr.message }, { status: 500 });

    // Build transcript from the group's messages.
    const { data: emails, error: emailsErr } = await supabaseAdmin
      .from('messages')
      .select(
        'ref_number, sent_at, subject, from_email, from_name, to_emails, cc_emails, direction, body_text, attachments(filename, extracted_text)'
      )
      .eq('sender_group_id', params.id)
      .eq('user_id', user.id)
      .order('sent_at', { ascending: true });
    if (emailsErr) return NextResponse.json({ error: emailsErr.message }, { status: 500 });

    const fullTranscript = buildTranscript((emails ?? []) as unknown as MessageRow[]);
    const transcript = trimTranscriptToBudget(fullTranscript, TRANSCRIPT_BUDGET_CHARS);

    const result = await askAboutTranscript({ transcript, question, history });
    const cost = estimateCostUsd(result.usage);
    const cached = (result.usage.cache_read_input_tokens ?? 0) > 0;

    // Persist assistant message.
    const { data: assistantMsg, error: asstErr } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        thread_id: threadId,
        role: 'assistant',
        content: result.answer,
        cost_usd: cost,
        cached,
      })
      .select('id')
      .single();
    if (asstErr || !assistantMsg)
      return NextResponse.json(
        { error: asstErr?.message ?? 'assistant insert failed' },
        { status: 500 }
      );

    // Bump thread totals.
    const { data: threadRow } = await supabaseAdmin
      .from('chat_threads')
      .select('total_cost_usd')
      .eq('id', threadId)
      .single();
    const prevCost = Number(threadRow?.total_cost_usd ?? 0);
    await supabaseAdmin
      .from('chat_threads')
      .update({
        total_cost_usd: prevCost + cost,
        updated_at: new Date().toISOString(),
      })
      .eq('id', threadId);

    return NextResponse.json({
      thread_id: threadId,
      answer: result.answer,
      message_id: assistantMsg.id,
      truncated: fullTranscript.length > transcript.length,
      transcript_chars: transcript.length,
      total_chars: fullTranscript.length,
      usage: result.usage,
      cost_usd: cost,
      cached,
    });
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}
