import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string; threadId: string } }
) {
  try {
    const user = await requireUser();

    const { data: thread, error: threadErr } = await supabaseAdmin
      .from('chat_threads')
      .select('id, title, total_cost_usd, created_at, updated_at')
      .eq('id', params.threadId)
      .eq('sender_group_id', params.id)
      .eq('user_id', user.id)
      .single();
    if (threadErr || !thread)
      return NextResponse.json({ error: 'thread not found' }, { status: 404 });

    const { data: messages, error: msgErr } = await supabaseAdmin
      .from('chat_messages')
      .select('id, role, content, cost_usd, cached, created_at')
      .eq('thread_id', params.threadId)
      .order('created_at', { ascending: true });
    if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

    return NextResponse.json({ thread, messages: messages ?? [] });
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}
