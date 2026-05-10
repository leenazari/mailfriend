import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/');

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('email, name')
    .eq('id', userId)
    .single();

  const { data: groups } = await supabaseAdmin
    .from('sender_groups')
    .select('id, name, description, email_addresses, last_synced_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return (
    <main className="min-h-screen">
      <header className="px-8 py-5 flex items-center justify-between border-b border-ink-800">
        <Link href="/dashboard" className="font-mono text-sm tracking-tight">
          <span className="text-accent">/</span>mailfriend
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-xs text-ink-400 font-mono">{user?.email}</span>
          <form action="/api/auth/signout" method="post">
            <button
              type="submit"
              className="text-xs text-ink-400 hover:text-ink-100 font-mono"
            >
              sign out
            </button>
          </form>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-8 py-12">
        <div className="flex items-end justify-between mb-10">
          <div>
            <h1 className="text-3xl font-medium tracking-tight">Sender groups</h1>
            <p className="mt-2 text-ink-400 text-sm">
              A group is one entity — a person, or a set of email addresses that
              represent a company or team.
            </p>
          </div>
          <Link
            href="/sender-groups/new"
            className="bg-accent hover:bg-accent-dim text-ink-950 font-medium px-5 py-2.5 rounded-md text-sm transition-colors"
          >
            + New group
          </Link>
        </div>

        {!groups || groups.length === 0 ? (
          <div className="border border-dashed border-ink-700 rounded-lg p-16 text-center">
            <p className="text-ink-400 text-sm">No groups yet.</p>
            <p className="text-ink-400 text-sm mt-1">
              Create one to start pulling correspondence.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {groups.map((g) => (
              <Link
                key={g.id}
                href={`/sender-groups/${g.id}`}
                className="block border border-ink-800 hover:border-ink-600 rounded-lg p-5 transition-colors group"
              >
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <div className="font-medium text-lg group-hover:text-accent transition-colors">
                      {g.name}
                    </div>
                    {g.description && (
                      <div className="text-sm text-ink-400 mt-1">{g.description}</div>
                    )}
                    <div className="font-mono text-xs text-ink-400 mt-3 truncate">
                      {(g.email_addresses as string[]).join(', ')}
                    </div>
                  </div>
                  <div className="text-right text-xs text-ink-400 font-mono shrink-0">
                    {g.last_synced_at ? (
                      <>synced {timeAgo(g.last_synced_at)}</>
                    ) : (
                      <span className="text-accent">never synced</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
