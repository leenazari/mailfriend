'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function NewSenderGroupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emails, setEmails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const list = emails
      .split(/[\n,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!name.trim()) return setError('Name required.');
    if (list.length === 0) return setError('Add at least one email address.');

    setSubmitting(true);
    try {
      const res = await fetch('/api/sender-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          email_addresses: list,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to create group.');
        setSubmitting(false);
        return;
      }
      router.push(`/sender-groups/${json.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen">
      <header className="px-8 py-5 flex items-center justify-between border-b border-ink-800">
        <Link href="/dashboard" className="font-mono text-sm tracking-tight">
          <span className="text-accent">/</span>mailfriend
        </Link>
        <Link href="/dashboard" className="text-xs text-ink-400 hover:text-ink-100 font-mono">
          ← back
        </Link>
      </header>

      <section className="max-w-2xl mx-auto px-8 py-12">
        <h1 className="text-3xl font-medium tracking-tight">New sender group</h1>
        <p className="mt-2 text-ink-400 text-sm">
          Group all email addresses that belong to one entity. For a company, add
          everyone you correspond with there.
        </p>

        <div className="mt-10 space-y-6">
          <Field label="Name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Highly Recruitment"
              className="w-full bg-ink-900 border border-ink-700 focus:border-accent rounded-md px-4 py-2.5 outline-none transition-colors"
            />
          </Field>

          <Field label="Description" hint="Optional. Just a note for yourself.">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Recruitment agency — pilot partner"
              className="w-full bg-ink-900 border border-ink-700 focus:border-accent rounded-md px-4 py-2.5 outline-none transition-colors"
            />
          </Field>

          <Field
            label="Email addresses"
            required
            hint="One per line, or separate with commas. We'll match messages where any of these is the sender, recipient, or cc."
          >
            <textarea
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              rows={6}
              placeholder={'sarah@highlyrec.com\njames@highlyrec.com\ninfo@highlyrec.com'}
              className="w-full bg-ink-900 border border-ink-700 focus:border-accent rounded-md px-4 py-2.5 outline-none font-mono text-sm transition-colors"
            />
          </Field>

          {error && (
            <div className="text-sm text-red-400 border border-red-400/30 bg-red-400/5 rounded px-4 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-accent hover:bg-accent-dim disabled:opacity-50 text-ink-950 font-medium px-6 py-2.5 rounded-md transition-colors"
            >
              {submitting ? 'Creating…' : 'Create group'}
            </button>
            <Link href="/dashboard" className="text-ink-400 hover:text-ink-100 text-sm">
              Cancel
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-sm font-medium mb-1.5">
        {label}
        {required && <span className="text-accent ml-1">*</span>}
      </div>
      {hint && <div className="text-xs text-ink-400 mb-2">{hint}</div>}
      {children}
    </div>
  );
}
