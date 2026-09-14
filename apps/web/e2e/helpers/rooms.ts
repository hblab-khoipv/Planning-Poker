import type { APIRequestContext } from '@playwright/test';
import type { CreateRoomResponse, DeckType } from '@planning-poker/shared';

/** Where the browser under test reaches the API; must match the value baked into the web build. */
export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
}

/**
 * Creates a room straight through the API. Used by specs whose subject is the *join* flow —
 * driving the create screen for them would test the same thing three times over and couple
 * unrelated specs together.
 */
export async function createRoomViaApi(
  request: APIRequestContext,
  options: { name?: string; deckType?: DeckType; displayName?: string } = {},
): Promise<CreateRoomResponse> {
  const response = await request.post(`${apiBaseUrl()}/rooms`, {
    data: {
      name: options.name ?? 'Sprint 42 refinement',
      deckType: options.deckType ?? 'fibonacci',
      displayName: options.displayName ?? 'Host',
    },
  });

  if (!response.ok()) {
    throw new Error(`could not create a room: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as CreateRoomResponse;
}
