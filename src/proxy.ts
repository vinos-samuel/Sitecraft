import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_COOKIE = 'omnilead_auth';

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;

  // Local dev without a password set → allow, so `npm run dev` just works.
  // In production APP_PASSWORD must be set; everything redirects to /login otherwise.
  if (!password && process.env.NODE_ENV === 'development') {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(AUTH_COOKIE)?.value;
  if (password && cookie === (await sha256Hex(password))) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Everything except the login page/API, Next internals, and static files
  matcher: ['/((?!login|api/login|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
