import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const { data, error } = await supabaseAdmin
      .from('messages')
      .select(
        'id, ref_number, sent_at, subject, from_email, from_name, to_emails, cc_emails, direction, snippet, body_text, attachments(id, filename, extracted_text)'
      )
      .eq('sender_group_id', params.id)
      .eq('user_id', user.id)
      .order('sent_at', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ messages: data ?? [] });
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}
