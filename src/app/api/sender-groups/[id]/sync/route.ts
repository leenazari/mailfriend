import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import {
  buildAddressQuery,
  ensureFreshAccessToken,
  extractBodyAndPdfs,
  getAttachment,
  getMessage,
  listMessageIds,
  parseAddressList,
  parseFromHeader,
} from '@/lib/gmail';
import { extractPdfText } from '@/lib/pdf';

export const dynamic = 'force-dynamic';
// Sync can take a while if there are many messages. Vercel hobby tier
// caps server function timeout at 60s; bump if you upgrade.
export const maxDuration = 60;

interface SyncResult {
  fetched: number;
  inserted: number;
  skipped: number;
  pdfs: number;
  errors: string[];
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const groupId = params.id;

    // Load the group, scoped to this user.
    const { data: group, error: groupErr } = await supabaseAdmin
      .from('sender_groups')
      .select('id, email_addresses')
      .eq('id', groupId)
      .eq('user_id', user.id)
      .single();
    if (groupErr || !group) return NextResponse.json({ error: 'group not found' }, { status: 404 });

    const token = await ensureFreshAccessToken(user.id);

    // Build search query and pull message IDs.
    const query = buildAddressQuery(group.email_addresses as string[]);
    const ids = await listMessageIds(token, query, 1000);

    // Find which of those Gmail IDs we already have for this user, to skip.
    const allGmailIds = ids.map((i) => i.id);
    const existing = await supabaseAdmin
      .from('messages')
      .select('gmail_message_id')
      .eq('user_id', user.id)
      .in('gmail_message_id', allGmailIds.length > 0 ? allGmailIds : ['__none__']);
    const existingSet = new Set(
      (existing.data ?? []).map((r) => r.gmail_message_id as string)
    );

    const result: SyncResult = {
      fetched: ids.length,
      inserted: 0,
      skipped: existingSet.size,
      pdfs: 0,
      errors: [],
    };

    const userEmail = user.email.toLowerCase();
    const groupEmails = new Set(
      (group.email_addresses as string[]).map((e) => e.toLowerCase())
    );

    // Process new messages serially. Could parallelise but Gmail rate limits
    // are gentle and serial keeps the code simple for a POC.
    for (const item of ids) {
      if (existingSet.has(item.id)) continue;
      try {
        const msg = await getMessage(token, item.id);
        const headers = msg.payload?.headers ?? [];
        const getH = (n: string) => headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value;

        const fromParsed = parseFromHeader(getH('From'));
        const toEmails = parseAddressList(getH('To'));
        const ccEmails = parseAddressList(getH('Cc'));
        const subject = getH('Subject') ?? null;
        const dateHeader = getH('Date');
        const sentAt = msg.internalDate
          ? new Date(parseInt(msg.internalDate, 10)).toISOString()
          : dateHeader
          ? new Date(dateHeader).toISOString()
          : new Date().toISOString();

        // Decide direction
        let direction: 'incoming' | 'outgoing' | 'other' = 'other';
        if (fromParsed.email && groupEmails.has(fromParsed.email)) direction = 'incoming';
        else if (fromParsed.email === userEmail) direction = 'outgoing';

        const { text, pdfs } = extractBodyAndPdfs(msg.payload);

        const insertMsg = await supabaseAdmin
          .from('messages')
          .insert({
            sender_group_id: groupId,
            user_id: user.id,
            gmail_message_id: msg.id,
            gmail_thread_id: msg.threadId,
            subject,
            from_email: fromParsed.email || null,
            from_name: fromParsed.name,
            to_emails: toEmails,
            cc_emails: ccEmails,
            sent_at: sentAt,
            body_text: text,
            snippet: msg.snippet,
            direction,
          })
          .select('id')
          .single();

        if (insertMsg.error || !insertMsg.data) {
          result.errors.push(`msg ${msg.id}: ${insertMsg.error?.message}`);
          continue;
        }

        for (const pdf of pdfs) {
          try {
            const buf = await getAttachment(token, msg.id, pdf.attachmentId);
            const extracted = await extractPdfText(buf);
            await supabaseAdmin.from('attachments').insert({
              message_id: insertMsg.data.id,
              filename: pdf.filename,
              mime_type: pdf.mimeType,
              size_bytes: pdf.size,
              extracted_text: extracted || null,
            });
            result.pdfs += 1;
          } catch (e) {
            result.errors.push(`pdf ${pdf.filename}: ${(e as Error).message}`);
          }
        }

        result.inserted += 1;
      } catch (e) {
        result.errors.push(`msg ${item.id}: ${(e as Error).message}`);
      }
    }

    // After insert, renumber ref_number for the whole group by sent_at asc.
    // Simple approach: pull all ids sorted, then update in batches.
    const allMsgs = await supabaseAdmin
      .from('messages')
      .select('id, sent_at')
      .eq('sender_group_id', groupId)
      .eq('user_id', user.id)
      .order('sent_at', { ascending: true });
    if (allMsgs.data) {
      let n = 1;
      for (const m of allMsgs.data) {
        await supabaseAdmin.from('messages').update({ ref_number: n }).eq('id', m.id);
        n += 1;
      }
    }

    await supabaseAdmin
      .from('sender_groups')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', groupId);

    return NextResponse.json(result);
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}
