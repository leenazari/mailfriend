import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import GroupView from './GroupView';

export const dynamic = 'force-dynamic';

export default async function SenderGroupPage({ params }: { params: { id: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/');

  const { data: group } = await supabaseAdmin
    .from('sender_groups')
    .select('id, name, description, email_addresses, last_synced_at')
    .eq('id', params.id)
    .eq('user_id', userId)
    .single();

  if (!group) notFound();

  return (
    <main className="min-h-screen">
      <header className="px-8 py-5 flex items-center justify-between border-b border-ink-800">
        <Link href="/dashboard" className="font-mono text-sm tracking-tight">
          <span className="text-accent">/</span>mailfriend
        </Link>
        <Link href="/dashboard" className="text-xs text-ink-400 hover:text-ink-100 font-mono">
          ← all groups
        </Link>
      </header>

      <GroupView group={group} />
    </main>
  );
}
