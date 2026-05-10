/**
 * Gmail helpers. READ-ONLY by design.
 *
 * Scope used: https://www.googleapis.com/auth/gmail.readonly
 * This scope CANNOT delete, modify, send, or trash any email. It can only read.
 *
 * Anywhere this file calls the Gmail API, we use GET only — no POST, no DELETE,
 * no modify endpoints. If you ever extend this file, keep it that way.
 */

import { supabaseAdmin } from './supabase';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

// ---------- token refresh ----------

export async function ensureFreshAccessToken(userId: string): Promise<string> {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('access_token, refresh_token, token_expires_at')
    .eq('id', userId)
    .single();
  if (error || !user) throw new Error('user not found');

  const expiresAt = user.token_expires_at ? new Date(user.token_expires_at).getTime() : 0;
  const now = Date.now();
  // Refresh if token expires in the next 60 seconds.
  if (expiresAt - now > 60_000 && user.access_token) {
    return user.access_token;
  }
  if (!user.refresh_token) {
    throw new Error('no refresh token; please sign in again');
  }

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: user.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token refresh failed: ${text}`);
  }
  const json = await res.json();
  const newAccess = json.access_token as string;
  const expiresIn = (json.expires_in as number) ?? 3600;
  const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  await supabaseAdmin
    .from('users')
    .update({ access_token: newAccess, token_expires_at: newExpiresAt })
    .eq('id', userId);
  return newAccess;
}

// ---------- low-level fetcher ----------

async function gmailGet<T>(token: string, path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(`${GMAIL_API}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail GET ${path} ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------- search & list ----------

export interface GmailListItem {
  id: string;
  threadId: string;
}

/**
 * Build a Gmail search query for "any message where one of these
 * addresses is in From, To, or Cc".
 */
export function buildAddressQuery(addresses: string[]): string {
  // Quote each address; combine each address with parentheses.
  const parts = addresses.map((addr) => {
    const a = addr.toLowerCase().trim();
    return `(from:${a} OR to:${a} OR cc:${a})`;
  });
  return parts.join(' OR ');
}

export async function listMessageIds(
  token: string,
  query: string,
  maxResults = 500
): Promise<GmailListItem[]> {
  const out: GmailListItem[] = [];
  let pageToken: string | undefined;
  do {
    const q: Record<string, string> = { q: query, maxResults: '100' };
    if (pageToken) q.pageToken = pageToken;
    const res = await gmailGet<{
      messages?: GmailListItem[];
      nextPageToken?: string;
    }>(token, '/users/me/messages', q);
    if (res.messages) out.push(...res.messages);
    pageToken = res.nextPageToken;
    if (out.length >= maxResults) break;
  } while (pageToken);
  return out.slice(0, maxResults);
}

// ---------- single message ----------

export interface GmailHeader {
  name: string;
  value: string;
}
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  snippet: string;
  payload: GmailPart;
}

export async function getMessage(token: string, id: string): Promise<GmailMessage> {
  return gmailGet<GmailMessage>(token, `/users/me/messages/${id}`, { format: 'full' });
}

export async function getAttachment(
  token: string,
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  const res = await gmailGet<{ data: string; size: number }>(
    token,
    `/users/me/messages/${messageId}/attachments/${attachmentId}`
  );
  // Gmail returns base64url
  const b64 = res.data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

// ---------- payload parsing ----------

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf-8');
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value;
}

function stripHtml(html: string): string {
  // Cheap-and-cheerful HTML stripping. For POC this is fine.
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|br|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface PdfAttachmentRef {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

/**
 * Walk the MIME tree, returning the best plain-text body and
 * a list of PDF attachments (only PDFs per the POC scope).
 */
export function extractBodyAndPdfs(payload: GmailPart): {
  text: string;
  pdfs: PdfAttachmentRef[];
} {
  let plainText = '';
  let htmlText = '';
  const pdfs: PdfAttachmentRef[] = [];

  function walk(part: GmailPart) {
    const mime = (part.mimeType || '').toLowerCase();
    const filename = part.filename || '';
    const data = part.body?.data;
    const attachmentId = part.body?.attachmentId;

    if (mime === 'text/plain' && data && !filename) {
      plainText += (plainText ? '\n' : '') + decodeBase64Url(data);
    } else if (mime === 'text/html' && data && !filename) {
      htmlText += (htmlText ? '\n' : '') + decodeBase64Url(data);
    } else if (
      filename &&
      attachmentId &&
      (mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf'))
    ) {
      pdfs.push({
        filename,
        mimeType: mime || 'application/pdf',
        size: part.body?.size ?? 0,
        attachmentId,
      });
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);

  const text = plainText || (htmlText ? stripHtml(htmlText) : '');
  return { text, pdfs };
}

export interface ParsedFromHeader {
  name: string | null;
  email: string;
}

export function parseFromHeader(value: string | undefined): ParsedFromHeader {
  if (!value) return { name: null, email: '' };
  // "Name" <email@example.com>  |  Name <email@example.com>  |  email@example.com
  const m = value.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: value.trim().toLowerCase() };
}

export function parseAddressList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => parseFromHeader(s).email)
    .filter(Boolean);
}
