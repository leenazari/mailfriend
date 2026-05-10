import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth';

export default async function HomePage() {
  const userId = await getCurrentUserId();
  if (userId) redirect('/dashboard');

  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-8 py-6 flex items-center justify-between border-b border-ink-800">
        <div className="font-mono text-sm tracking-tight">
          <span className="text-accent">/</span>mailfriend
        </div>
        <div className="text-xs text-ink-400 font-mono">read-only · POC</div>
      </header>

      <section className="flex-1 flex items-center px-8">
        <div className="max-w-3xl">
          <h1 className="text-5xl md:text-6xl font-medium leading-[1.05] tracking-tight">
            Read every word
            <br />
            <span className="text-accent">they ever sent you.</span>
          </h1>
          <p className="mt-6 text-ink-200 text-lg max-w-xl leading-relaxed">
            Pick a sender or a company. Pull the entire history of correspondence —
            messages, dates, attachments — into a single transcript. Ask questions.
            Get the answer in seconds.
          </p>
          <p className="mt-3 text-ink-400 text-sm max-w-xl">
            Read-only Gmail access. Nothing in this app can delete, modify or send mail.
          </p>

          <div className="mt-10">
            <Link
              href="/api/auth/google"
              className="inline-flex items-center gap-3 bg-accent hover:bg-accent-dim text-ink-950 font-medium px-6 py-3 rounded-md transition-colors"
            >
              <GoogleGlyph />
              Continue with Google
            </Link>
          </div>
        </div>
      </section>

      <footer className="px-8 py-6 text-xs text-ink-400 font-mono border-t border-ink-800">
        scope: gmail.readonly
      </footer>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.1l6.6 4.8C14.6 15.2 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4c-7.7 0-14.4 4.4-17.7 10.1z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.3 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.4 39.6 16.1 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2.1-2 3.9-3.7 5.3l6.2 5.2c-.4.4 6.7-4.9 6.7-14.5 0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}
