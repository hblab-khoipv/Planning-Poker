import type { RoomHistoryResponse } from '@planning-poker/shared';
import { Router } from 'express';
import type pg from 'pg';
import { listRoomHistoryForUser } from '../db/repositories/index.js';
import { asyncRoute, unauthorized } from '../http/errors.js';
import { toRoomHistoryEntryDto } from '../http/history.js';
import { resolveCaller } from '../http/session.js';

/**
 * Endpoints scoped to the caller themselves (PRD FR-9).
 *
 * `/users/me/...` rather than `/users/:id/...` is the whole authorisation model of this router:
 * there is no id in the URL to tamper with, so the only account these routes can read is the one
 * the NextAuth cookie decrypts to (`http/session.ts`). Asking for somebody else's history is not
 * a request that gets refused here — it is a request that cannot be expressed.
 */
export function createUsersRouter(pool: pg.Pool): Router {
  const router = Router();

  /**
   * FR-9: the rooms this account created or joined, newest activity first.
   *
   * A guest gets 401 rather than an empty list. The two are not the same answer: an empty list
   * means "you have no past sessions", which would be a lie told to somebody who has been in
   * ten rooms today and simply has no account to have recorded them against. The status is what
   * the history screen keys on to show "đăng nhập để xem lịch sử" instead of "chưa có phòng nào".
   */
  router.get(
    '/me/rooms',
    asyncRoute(async (req, res) => {
      const caller = await resolveCaller(req);
      if (!caller) throw unauthorized('you must be signed in to see your session history');

      const entries = await listRoomHistoryForUser(pool, caller.userId);
      const body: RoomHistoryResponse = { rooms: entries.map(toRoomHistoryEntryDto) };
      res.status(200).json(body);
    }),
  );

  return router;
}
