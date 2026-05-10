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
import { uploadPdfToStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface SyncResult {
  fetched: number;
  inserted: number;
  skipped: number;
  pdfs_added: number;
  pdfs_backfilled: number;
  errors: string[];
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const groupId = params.id;

    const { data: group, error: groupErr } = await supabaseAdmin
      .from('sender_groups')
      .select('id, email_addresses')
      .eq('id', groupId)
      .eq('user_id', user.id)
      .single();
    if (groupErr || !group) return NextResponse.json({ error: 'group not found' }, { status: 404 });

    const token = await ensureFreshAccessToken(user.id);

    const query = buildAddressQuery(group.email_addresses as string[]);
    const ids = await listMessageIds(token, query, 1000);

    const allGmailIds = ids.map((i) => i.id);
    const existing = await supabaseAdmin
      .from('messages')
      .select('id, gmail_message_id')
      .eq('user_id', user.id)
      .in('gmail_message_id', allGmailIds.length > 0 ? allGmailIds : ['__none__']);
    const existingByGmailId = new Map<string, string>();
    for (const row of existing.data ?? []) {
      existingByGmailId.set(row.gmail_message_id as string, row.id as string);
    }

    const result: SyncResult = {
      fetched: ids.length,
      inserted: 0,
      skipped: existingByGmailId.size,
      pdfs_added: 0,
      pdfs_backfilled: 0,
      errors: [],
    };

    const userEmail = user.email.toLowerCase();
    const groupEmails = new Set(
      (group.email_addresses as string[]).map((e) => e.toLowerCase())
    );

    // ----- Pass 1: backfill storage for previously-synced attachments -----
    // Find attachments owned by this user, in this group, that lack a storage_path.
    const { data: backfillRows } = await supabaseAdmin
      .from('attachments')
      .select('id, filename, message_id, messages!inner(gmail_message_id, sender_group_id, user_id)')
      .is('storage_path', null);

    const backfillForThisGroup = (backfillRows ?? []).filter((r) => {
      const m = Array.isArray(r.messages)
        ? r.messages[0]
        : (r.messages as { user_id: string; sender_group_id: string } | null);
      return m?.user_id === user.id && m?.sender_group_id === groupId;
    });

    // Group attachments by gmail_message_id so we only fetch each message once.
    const byGmailId = new Map<string, typeof backfillForThisGroup>();
    for (const att of backfillForThisGroup) {
      const m = Array.isArray(att.messages)
        ? att.messages[0]
        : (att.messages as { gmail_message_id: string } | null);
      if (!m) continue;
      const list = byGmailId.get(m.gmail_message_id) ?? [];
      list.push(att);
      byGmailId.set(m.gmail_message_id, list);
    }

    for (const [gmailMsgId, atts] of byGmailId.entries()) {
      try {
        const msg = await getMessage(token, gmailMsgId);
        const { pdfs } = extractBodyAndPdfs(msg.payload);
        for (const att of atts) {
          const match = pdfs.find((p) => p.filename === att.filename);
          if (!match) continue;
          const buf = await getAttachment(token, gmailMsgId, match.attachmentId);
          const path = await uploadPdfToStorage({
            userId: user.id,
            messageId: att.message_id,
            attachmentId: att.id,
            buffer: buf,
          });
          await supabaseAdmin
            .from('attachments')
            .update({ storage_path: path })
            .eq('id', att.id);
          result.pdfs_backfilled += 1;
        }
      } catch (e) {
        result.errors.push(`backfill ${gmailMsgId}: ${(e as Error).message}`);
      }
    }

    // ----- Pass 2: pull and store new messages -----
    for (const item of ids) {
      if (existingByGmailId.has(item.id)) continue;
      try {
        const msg = await getMessage(token, item.id);
        const headers = msg.payload?.headers ?? [];
        const getH = (n: string) =>
          headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value;

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

            const attInsert = await supabaseAdmin
              .from('attachments')
              .insert({
                message_id: insertMsg.data.id,
                filename: pdf.filename,
                mime_type: pdf.mimeType,
                size_bytes: pdf.size,
                extracted_text: extracted || null,
              })
              .select('id')
              .single();

            if (attInsert.error || !attInsert.data) {
              result.errors.push(
                `pdf ${pdf.filename}: ${attInsert.error?.message ?? 'insert failed'}`
              );
              continue;
            }

            try {
              const path = await uploadPdfToStorage({
                userId: user.id,
                messageId: insertMsg.data.id,
                attachmentId: attInsert.data.id,
                buffer: buf,
              });
              await supabaseAdmin
                .from('attachments')
                .update({ storage_path: path })
                .eq('id', attInsert.data.id);
            } catch (storeErr) {
              result.errors.push(
                `upload ${pdf.filename}: ${(storeErr as Error).message}`
              );
            }

            result.pdfs_added += 1;
          } catch (e) {
            result.errors.push(`pdf ${pdf.filename}: ${(e as Error).message}`);
          }
        }

        result.inserted += 1;
      } catch (e) {
        result.errors.push(`msg ${item.id}: ${(e as Error).message}`);
      }
    }

    // Renumber the whole group chronologically.
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
