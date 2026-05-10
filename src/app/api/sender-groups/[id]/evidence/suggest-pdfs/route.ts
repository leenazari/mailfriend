import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface PdfMetadata {
  id: string;
  filename: string;
  message_ref: number | null;
  message_subject: string | null;
  message_date: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const answerTexts: string[] = Array.isArray(body.answer_texts)
      ? body.answer_texts.filter((t: unknown) => typeof t === 'string')
      : [];

    // Confirm group ownership.
    const { data: group } = await supabaseAdmin
      .from('sender_groups')
      .select('id')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();
    if (!group) return NextResponse.json({ error: 'group not found' }, { status: 404 });

    // Pull every PDF in this group (with message metadata).
    const { data, error } = await supabaseAdmin
      .from('attachments')
      .select(
        'id, filename, storage_path, messages!inner(ref_number, subject, sent_at, user_id, sender_group_id)'
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const availablePdfs: PdfMetadata[] = (data ?? [])
      .filter((row) => {
        const m = Array.isArray(row.messages)
          ? row.messages[0]
          : (row.messages as { user_id: string; sender_group_id: string } | null);
        return m?.user_id === user.id && m?.sender_group_id === params.id;
      })
      .map((row) => {
        const m = Array.isArray(row.messages) ? row.messages[0] : (row.messages as { ref_number: number | null; subject: string | null; sent_at: string });
        return {
          id: row.id as string,
          filename: row.filename as string,
          message_ref: m?.ref_number ?? null,
          message_subject: m?.subject ?? null,
          message_date: m?.sent_at ?? new Date().toISOString(),
        };
      });

    // No PDFs? No need to call the model.
    if (availablePdfs.length === 0 || answerTexts.length === 0) {
      return NextResponse.json({
        available_pdfs: availablePdfs,
        recommended_pdf_ids: [],
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Fail open — return all PDFs as unselected, let the user pick manually.
      return NextResponse.json({
        available_pdfs: availablePdfs,
        recommended_pdf_ids: [],
      });
    }
    const anthropic = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

    const pdfListing = availablePdfs
      .map((p) => {
        const date = new Date(p.message_date).toISOString().slice(0, 10);
        const subject = p.message_subject ?? '(no subject)';
        return `- id="${p.id}" | "${p.filename}" | from email #${
          p.message_ref ?? '?'
        } (${date}) "${subject}"`;
      })
      .join('\n');

    const answersBlock = answerTexts
      .map((t, i) => `<answer index="${i + 1}">\n${t}\n</answer>`)
      .join('\n\n');

    const prompt = `You are assembling an evidence pack for a legal matter. The user has selected the following analyst answers from their email-correspondence investigation:

${answersBlock}

The following PDF attachments are available in their email correspondence:

${pdfListing}

Pick the PDFs that constitute essential evidence for the selected answers. Consider:
- PDFs the answers directly reference or quote
- Contracts, agreements, receipts, or written promises that substantiate claims
- Reports, assessments, or specifications relevant to the matter
- Records of communications that prove dates, commitments, or terms

Respond with ONLY a JSON array of attachment IDs (the id="..." strings above) and nothing else. No prose, no markdown. If none are relevant, return [].

Example response: ["abc-123","def-456"]`;

    let recommendedIds: string[] = [];
    try {
      const res = await anthropic.messages.create({
        model,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      // Extract JSON array from the response.
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          const valid = new Set(availablePdfs.map((p) => p.id));
          recommendedIds = parsed
            .filter((x): x is string => typeof x === 'string' && valid.has(x));
        }
      }
    } catch (e) {
      // Fall through with empty recommendations.
      console.warn('[suggest-pdfs] AI call failed:', (e as Error).message);
    }

    return NextResponse.json({
      available_pdfs: availablePdfs,
      recommended_pdf_ids: recommendedIds,
    });
  } catch (res) {
    if (res instanceof Response) return res;
    return NextResponse.json({ error: String(res) }, { status: 500 });
  }
}
