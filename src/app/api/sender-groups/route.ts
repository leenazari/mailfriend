import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const { data, error } = await supabaseAdmin
      .from('sender_groups')
      .select('id, name, description, email_addresses, last_synced_at, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ groups: data ?? [] });
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const name = String(body.name ?? '').trim();
    const description = body.description ? String(body.description).trim() : null;
    const emailAddresses: string[] = Array.isArray(body.email_addresses)
      ? body.email_addresses.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean)
      : [];
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    if (emailAddresses.length === 0)
      return NextResponse.json({ error: 'at least one email address required' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('sender_groups')
      .insert({
        user_id: user.id,
        name,
        description,
        email_addresses: emailAddresses,
      })
      .select('id')
      .single();

    if (error || !data)
      return NextResponse.json({ error: error?.message ?? 'insert failed' }, { status: 500 });
    return NextResponse.json({ id: data.id });
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}
