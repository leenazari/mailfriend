import { supabaseAdmin } from './supabase';

export const ATTACHMENTS_BUCKET = 'mailfriend-attachments';

/**
 * Upload a PDF buffer to Supabase Storage.
 * Returns the storage path on success.
 */
export async function uploadPdfToStorage(opts: {
  userId: string;
  messageId: string;
  attachmentId: string;
  buffer: Buffer;
}): Promise<string> {
  const path = `${opts.userId}/${opts.messageId}/${opts.attachmentId}.pdf`;
  const { error } = await supabaseAdmin.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, opts.buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return path;
}

/**
 * Generate a short-lived signed URL for a PDF in private storage.
 */
export async function signedUrlForPdf(path: string, ttlSeconds = 60): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data) throw new Error(`signed url failed: ${error?.message ?? 'unknown'}`);
  return data.signedUrl;
}
