import { NextRequest, NextResponse } from 'next/server';
import { setSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  if (error) return new NextResponse(`OAuth error: ${error}`, { status: 400 });
  if (!code) return new NextResponse('Missing code', { status: 400 });

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

  // 1. Exchange code for tokens.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) {
    const t = await tokenRes.text();
    return new NextResponse(`Token exchange failed: ${t}`, { status: 400 });
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  };

  // 2. Get user profile.
  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileRes.ok) {
    return new NextResponse('Failed to fetch profile', { status: 400 });
  }
  const profile = (await profileRes.json()) as {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
  };

  // 3. Upsert user.
  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Look up existing user to preserve refresh_token if Google doesn't send one.
  const existing = await supabaseAdmin
    .from('users')
    .select('id, refresh_token')
    .eq('google_id', profile.sub)
    .maybeSingle();

  const refreshToken = tokens.refresh_token ?? existing.data?.refresh_token ?? null;

  const upsertRes = await supabaseAdmin
    .from('users')
    .upsert(
      {
        google_id: profile.sub,
        email: profile.email,
        name: profile.name ?? null,
        picture: profile.picture ?? null,
        access_token: tokens.access_token,
        refresh_token: refreshToken,
        token_expires_at: tokenExpiresAt,
      },
      { onConflict: 'google_id' }
    )
    .select('id')
    .single();

  if (upsertRes.error || !upsertRes.data) {
    return new NextResponse(`DB error: ${upsertRes.error?.message ?? 'unknown'}`, { status: 500 });
  }

  await setSession(upsertRes.data.id);
  return NextResponse.redirect(new URL('/dashboard', req.url));
}
