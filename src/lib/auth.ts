import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from './supabase';

const COOKIE_NAME = 'ga_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not set');
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function createSessionCookie(userId: string): string {
  const sig = sign(userId);
  return `${userId}.${sig}`;
}

export function verifySessionCookie(value: string): string | null {
  const [userId, sig] = value.split('.');
  if (!userId || !sig) return null;
  const expected = sign(userId);
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return null;
    return timingSafeEqual(a, b) ? userId : null;
  } catch {
    return null;
  }
}

export async function setSession(userId: string) {
  cookies().set(COOKIE_NAME, createSessionCookie(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearSession() {
  cookies().delete(COOKIE_NAME);
}

export async function getCurrentUserId(): Promise<string | null> {
  const c = cookies().get(COOKIE_NAME);
  if (!c) return null;
  return verifySessionCookie(c.value);
}

export async function requireUser() {
  const userId = await getCurrentUserId();
  if (!userId) throw new Response('Unauthorized', { status: 401 });
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error || !data) throw new Response('Unauthorized', { status: 401 });
  return data as {
    id: string;
    google_id: string;
    email: string;
    name: string | null;
    picture: string | null;
    access_token: string;
    refresh_token: string | null;
    token_expires_at: string | null;
  };
}
