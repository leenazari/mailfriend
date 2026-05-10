import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const id = await getCurrentUserId();
  if (!id) return NextResponse.json({ user: null });
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, email, name, picture')
    .eq('id', id)
    .single();
  return NextResponse.json({ user: data ?? null });
}
