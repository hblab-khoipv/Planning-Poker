import NextAuth from 'next-auth';
import { authOptions } from '@/server/auth/options';

/**
 * NextAuth's own endpoints: /api/auth/signin, /callback/:provider, /session, /csrf, /signout.
 * Registration is not one of them (NextAuth has no sign-up concept for credentials) and lives
 * at /api/register instead.
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
