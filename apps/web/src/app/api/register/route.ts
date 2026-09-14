import { NextResponse } from 'next/server';
import { registerUser } from '@/server/auth/credentials';

/** Sign-up for the Credentials provider. The client signs in right after a 201 (see /register). */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ['Body phải là JSON hợp lệ.'] }, { status: 400 });
  }

  const { email, password, displayName } = (body ?? {}) as Record<string, unknown>;

  const result = await registerUser({
    email: typeof email === 'string' ? email : '',
    password: typeof password === 'string' ? password : '',
    displayName: typeof displayName === 'string' ? displayName : null,
  });

  if (!result.ok) {
    return NextResponse.json({ errors: result.errors }, { status: result.status });
  }

  // Deliberately nothing but the id and the display name: the response is not a session.
  return NextResponse.json(
    {
      user: { id: result.user.id, email: result.user.email, displayName: result.user.displayName },
    },
    { status: 201 },
  );
}
