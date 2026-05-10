import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { buildTranscript, MessageRow } from '@/lib/transcript';

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
        'ref_number, sent_at, subject, from_email, from_name, to_emails, cc_emails, direction, body_text, attachments(filename, extracted_text)'
      )
      .eq('sender_group_id', params.id)
      .eq('user_id', user.id)
      .order('sent_at', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const transcript = buildTranscript((data ?? []) as unknown as MessageRow[]);
    return new NextResponse(transcript, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}
