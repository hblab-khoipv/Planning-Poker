import type {
  ApiErrorResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  ParticipantsResponse,
  RoomResponse,
} from '@planning-poker/shared';

/**
 * The browser's side of the room REST API (`apps/api`).
 *
 * Requests go straight to the API origin rather than through a Next.js route: the two processes
 * run on one host and are the same site, so NextAuth's session cookie rides along with
 * `credentials: 'include'` and the API can identify a signed-in caller itself.
 */

export const DEFAULT_API_BASE_URL = 'http://localhost:4000';

export function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  return (configured && configured.length > 0 ? configured : DEFAULT_API_BASE_URL).replace(
    /\/+$/,
    '',
  );
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
}

/** Messages a Vietnamese-speaking user should see, keyed by what actually went wrong. */
export function messageForError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNotFound) return 'Không tìm thấy phòng với mã này. Hãy kiểm tra lại mã phòng.';
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
