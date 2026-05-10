import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// List all chat threads for a sender group.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const { data, error } = await supabaseAdmin
      .from('chat_threads')
      .select('id, title, total_cost_usd, created_at, updated_at')
      .eq('sender_group_id', params.id)
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Add message counts in a single follow-up query.
    const ids = (data ?? []).map((t) => t.id);
    let counts: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: msgs } = await supabaseAdmin
        .from('chat_messages')
        .select('thread_id')
        .in('thread_id', ids);
      for (const m of msgs ?? []) {
        const tid = (m as { thread_id: string }).thread_id;
        counts[tid] = (counts[tid] ?? 0) + 1;
      }
    }
    const threads = (data ?? []).map((t) => ({ ...t, message_count: counts[t.id] ?? 0 }));
    return NextResponse.json({ threads });
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}

// Create a new (empty) thread.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();

    // Confirm group belongs to this user.
    const { data: group } = await supabaseAdmin
      .from('sender_groups')
      .select('id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();
    if (!group) return NextResponse.json({ error: 'group not found' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const title = body.title ? String(body.title).slice(0, 200) : null;

    const { data, error } = await supabaseAdmin
      .from('chat_threads')
      .insert({ sender_group_id: params.id, user_id: user.id, title })
      .select('id, title, total_cost_usd, created_at, updated_at')
      .single();
    if (error || !data)
      return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 });

    return NextResponse.json({ thread: { ...data, message_count: 0 } });
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}
