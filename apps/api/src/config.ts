import 'dotenv/config';

function optionalNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * CORS_ORIGIN accepts a comma-separated list: the browser reaches the app on more than one
 * hostname in practice (localhost and 127.0.0.1 are different origins to a browser, and the
 * e2e run uses the latter).
 */
function originList(value: string | undefined, fallback: string[]): string[] {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : fallback;
}

export const config = {
  port: optionalNumber(process.env.PORT, 4000),
  corsOrigin: originList(process.env.CORS_ORIGIN, [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgresql://planning_poker:planning_poker@localhost:5432/planning_poker',
  /** Shared with apps/web so the API can verify NextAuth's session cookie (see http/session.ts). */
  nextAuthSecret: process.env.NEXTAUTH_SECRET ?? '',
  /**
   * How long a dropped socket keeps its seat marked online before it counts as having left.
   * PRD §12 lists reconnect-on-network-drop as an open question; a short window is the
   * conservative answer — a tab reload or a lift-doors moment does not flush somebody out of
   * the room, and the only cost is that a genuine departure shows up this many ms late.
   */
  socketDisconnectGraceMs: optionalNumber(process.env.SOCKET_DISCONNECT_GRACE_MS, 5000),
} as const;
