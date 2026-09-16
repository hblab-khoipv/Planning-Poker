import type {
  ApiErrorResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  ParticipantsResponse,
  RoomHistoryDetailResponse,
  RoomHistoryResponse,
  RoomResponse,
} from '@planning-poker/shared';

/**
 * The browser's side of the room REST API (`apps/api`).
 *
 * Requests go straight to the API origin rather than through a Next.js route: the two processes
 * run on one host and are the same site, so NextAuth's session cookie rides along with
 * `credentials: 'include'` and the API can identify a signed-in caller itself.
 */

/** Where the API listens in a development or single-host deployment. */
export const DEFAULT_API_PORT = 4000;

/** The fallback used when there is no configuration and no page to take a host from. */
export const DEFAULT_API_BASE_URL = `http://localhost:${DEFAULT_API_PORT}`;

/**
 * The API origin this browser should talk to.
 *
 * `NEXT_PUBLIC_API_URL` wins when it is set. Otherwise the host is taken from the page rather
 * than hard-coded, because a *cookie is scoped to a host and ignores the port*: a page served
 * from 127.0.0.1 that calls an API on `localhost` sends no NextAuth cookie at all, so the API
 * sees a guest and session history (FR-9) silently comes back 401. Deriving the host keeps the
 * two the same site whichever name the page was opened under, which is also exactly how the
 * single-EC2 deployment target is addressed.
 */
export function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured && configured.length > 0) return configured.replace(/\/+$/, '');

  // No window on the server; nothing there issues API calls, so the constant is enough.
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_API_PORT}`;
  }
  return DEFAULT_API_BASE_URL;
}

export function apiUrl(path: string): string {
  return `${apiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** A non-2xx answer from the API, carrying the machine-readable code the routes return. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** No signed-in caller. The history screens turn this into a prompt to sign in. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Signed in, but this is somebody else's room (FR-9 is scoped to sessions you were in). */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/** Messages a Vietnamese-speaking user should see, keyed by what actually went wrong. */
export function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNotFound) return 'Không tìm thấy phòng với mã này. Hãy kiểm tra lại mã phòng.';
    if (error.isUnauthorized) return 'Bạn cần đăng nhập để xem lịch sử phiên.';
    if (error.isForbidden) return 'Bạn không tham gia phòng này nên không xem được lịch sử của nó.';
    if (error.status === 400) return error.message;
    return 'Có lỗi xảy ra, vui lòng thử lại.';
  }
  return 'Không kết nối được tới máy chủ. Vui lòng kiểm tra kết nối và thử lại.';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  });

  if (!response.ok) {
    // An error body is the contract, but a proxy or a crash can still return something else.
    const body = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'internal',
      body?.error?.message ?? `request failed with status ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

export function createRoom(input: CreateRoomRequest): Promise<CreateRoomResponse> {
  return request<CreateRoomResponse>('/rooms', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchRoom(code: string): Promise<RoomResponse> {
  return request<RoomResponse>(`/rooms/${encodeURIComponent(code)}`);
}

export function joinRoom(code: string, input: JoinRoomRequest): Promise<JoinRoomResponse> {
  return request<JoinRoomResponse>(`/rooms/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchParticipants(code: string): Promise<ParticipantsResponse> {
  return request<ParticipantsResponse>(`/rooms/${encodeURIComponent(code)}/participants`);
}

/**
 * FR-9's two reads. Both rely on `credentials: 'include'` above carrying NextAuth's cookie to
 * the API origin — there is no user id in either URL, so an unauthenticated call is a 401 rather
 * than a call for the wrong person.
 */

export function fetchMyRoomHistory(): Promise<RoomHistoryResponse> {
  return request<RoomHistoryResponse>('/users/me/rooms');
}

export function fetchRoomHistory(code: string): Promise<RoomHistoryDetailResponse> {
  return request<RoomHistoryDetailResponse>(`/rooms/${encodeURIComponent(code)}/rounds`);
}
