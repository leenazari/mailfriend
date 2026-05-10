import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { signedUrlForPdf } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();

    // Verify the attachment belongs to a message owned by this user.
    const { data, error } = await supabaseAdmin
      .from('attachments')
      .select('id, filename, storage_path, messages!inner(user_id)')
      .eq('id', params.id)
      .single();

    if (error || !data)
      return NextResponse.json({ error: 'attachment not found' }, { status: 404 });

    // The "messages!inner(user_id)" join returns an object (one-to-one), but
    // Supabase types it as an array on the client. Handle both.
    const owner = Array.isArray(data.messages)
      ? data.messages[0]?.user_id
      : (data.messages as { user_id: string } | null)?.user_id;
    if (owner !== user.id)
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    if (!data.storage_path) {
      return NextResponse.json(
        {
          error:
            'this PDF was synced before download support was added — re-sync the group to backfill',
        },
        { status: 409 }
      );
    }

    const url = await signedUrlForPdf(data.storage_path, 120);
    return NextResponse.redirect(url);
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}
