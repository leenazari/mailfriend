# MailFriend — POC

Your friend for understanding everything in your inbox.

Pull every email exchanged with a person or company, build a chronological
catalog and a unified transcript (with PDF attachments transcribed inline),
then ask Claude questions about the whole conversation.

**Read-only by design.** The Gmail OAuth scope is `gmail.readonly`. This
token cannot delete, modify, send, or trash any email. There is no delete
button anywhere in the UI.

## Stack

- Next.js 14 (App Router) on Vercel
- Supabase (Postgres) for storage
- Google OAuth (Gmail readonly)
- pdf-parse for PDF text extraction
- Anthropic Claude (`claude-sonnet-4-6` by default) for chat queries

## Setup

### 1. Clone / drop into a fresh repo

```bash
git init mailfriend && cd mailfriend
# copy every file from this folder in
npm install
```

### 2. Supabase

1. Create a new Supabase project.
2. In the SQL editor, paste and run `supabase/schema.sql`.
3. Project Settings → API: copy `Project URL` and `service_role` key.

### 3. Google Cloud OAuth

1. Go to https://console.cloud.google.com → create a project (or pick one).
2. APIs & Services → Library → enable **Gmail API**.
3. APIs & Services → OAuth consent screen
   - User type: **External**
   - App name, support email, developer email — fill in.
   - Scopes: add `.../auth/gmail.readonly` (plus the default openid/email/profile).
   - Test users: add your own Gmail address (and anyone else who'll test).
4. APIs & Services → Credentials → **Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/google/callback`
     - `https://your-vercel-domain.vercel.app/api/auth/google/callback`
   - Copy the Client ID and Client Secret.

### 4. Anthropic API key

Go to https://console.anthropic.com → API keys → create one. Make sure your
account has credit (the chat feature won't work otherwise).

### 5. Environment variables

```bash
cp .env.example .env.local
# Then fill in the values.
```

Generate the session secret:

```bash
openssl rand -hex 32
```

### 6. Run it

```bash
npm run dev
# open http://localhost:3000
```

### 7. Deploy to Vercel

1. Push to GitHub.
2. Import in Vercel.
3. Add **the same env vars** in Project Settings → Environment Variables.
   Update `GOOGLE_REDIRECT_URI` and `APP_URL` to the Vercel URL.
4. Make sure that Vercel URL's `/api/auth/google/callback` is registered in
   your Google OAuth client.

## How it works

### Sender groups

A "sender group" is one entity — a single person, or a set of email
addresses that represent a company (e.g. all Highly Recruitment staff
you correspond with). When you sync, the app pulls every email where
**any** of those addresses appears as From, To, or Cc.

### Sync

Hitting **Sync** runs:

1. `gmail.users.messages.list` with the OR'd address query.
2. For each message ID not already in the DB:
   - `gmail.users.messages.get` (full payload)
   - Walks the MIME tree for `text/plain` (falls back to stripped HTML).
   - Pulls every PDF attachment, runs pdf-parse on it, stores the text.
3. After insert, every message in the group is renumbered chronologically
   (the `#` reference you see in the catalog).

### Catalog (the "log")

Chronological table: ref number, timestamp, direction (in/out), from, subject,
PDF count.

### Transcript

A single text blob in the format:

```
── #1  ← IN   2025-04-12 14:32 UTC
Subject: Project kickoff
From:    Sarah Williams <sarah@highlyrec.com>
To:      lee@yourdomain.com

(body text here)

[attachment: brief.pdf]
(extracted PDF text here)
```

Designed to read cleanly *and* be cheap context for an LLM.

### Ask AI

The full transcript (trimmed to ~150k chars from the most recent end if
needed) is sent to Claude with your question and the last 10 turns of chat
history. Claude is instructed to ground every answer in the transcript and
say "not in the transcript" when it isn't.

## What this is not (yet)

- No vector embeddings / RAG. For very long histories the transcript is
  trimmed to the most recent portion. v2 = pgvector + chunked retrieval.
- PDF only on attachments. Images, .docx, .xlsx ignored.
- No background sync — you press the button.
- No webhook / push notifications from Gmail. Manual re-sync.
- No multi-user team features. One Google account per app session.

## Safety notes

- Gmail scope: `gmail.readonly`. Cannot mutate the mailbox.
- No delete UI for cached messages. If you want to wipe the cache, do it
  in Supabase directly.
- OAuth tokens are stored in the `users` table. For production, encrypt
  them at rest (e.g. pgcrypto + symmetric key in a secret manager).
- Service role key is server-only — never imported into a client component.

## File map

```
src/
  app/
    page.tsx                          landing / sign in
    dashboard/page.tsx                list of sender groups
    sender-groups/
      new/page.tsx                    create form
      [id]/
        page.tsx                      group page (server)
        GroupView.tsx                 tabs: catalog / transcript / chat
    api/
      auth/google/route.ts            start OAuth
      auth/google/callback/route.ts   complete OAuth, set session cookie
      auth/signout/route.ts
      auth/me/route.ts
      sender-groups/route.ts          list / create
      sender-groups/[id]/sync/route.ts        the heavy lifter
      sender-groups/[id]/messages/route.ts    the catalog
      sender-groups/[id]/transcript/route.ts  the unified text
      sender-groups/[id]/chat/route.ts        Claude Q&A
  lib/
    auth.ts                           cookie session helpers
    supabase.ts                       service-role client
    gmail.ts                          read-only Gmail wrapper
    pdf.ts                            pdf-parse wrapper
    anthropic.ts                      Claude client
    transcript.ts                     transcript builder
supabase/
  schema.sql                          run this once
```
