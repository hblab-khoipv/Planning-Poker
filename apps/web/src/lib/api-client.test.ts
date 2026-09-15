import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiBaseUrl,
  apiUrl,
  DEFAULT_API_BASE_URL,
  DEFAULT_API_PORT,
  messageForError,
} from '@/lib/api-client';

describe('apiBaseUrl', () => {
  const original = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = original;
  });

  it('falls back to the local API when nothing is configured', () => {
    delete process.env.NEXT_PUBLIC_API_URL;

    expect(apiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
  });

  it('ignores a blank value, which is what an unset CI variable expands to', () => {
    process.env.NEXT_PUBLIC_API_URL = '   ';

    expect(apiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
  });

  /**
   * The bug this guards against is invisible in the happy path: cookies are scoped to a host and
   * ignore the port, so a page on 127.0.0.1 calling an API on `localhost` sends no session
   * cookie and every authenticated read (session history) comes back 401.
   */
  it('takes the host from the page when nothing is configured', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    vi.stubGlobal('window', {
      location: { protocol: 'http:', hostname: '127.0.0.1' },
    });

    expect(apiBaseUrl()).toBe(`http://127.0.0.1:${DEFAULT_API_PORT}`);

    vi.unstubAllGlobals();
  });

  it('drops a trailing slash so paths do not end up doubled', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://poker.example.com/';

    expect(apiUrl('/rooms')).toBe('https://poker.example.com/rooms');
  });

  it('tolerates a path given without its leading slash', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://poker.example.com';

    expect(apiUrl('rooms')).toBe('https://poker.example.com/rooms');
  });
});

describe('messageForError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('explains a 404 as a wrong room code, which is the only way to get one', () => {
    expect(messageForError(new ApiError(404, 'not_found', 'room not found'))).toContain(
      'Không tìm thấy phòng',
    );
  });

  it('passes a validation message through, because it says what to fix', () => {
    expect(messageForError(new ApiError(400, 'validation_error', 'displayName is required'))).toBe(
      'displayName is required',
    );
  });

  it('does not show a server-side failure verbatim', () => {
    expect(messageForError(new ApiError(500, 'internal', 'internal server error'))).toBe(
      'Có lỗi xảy ra, vui lòng thử lại.',
    );
  });

  it('reports a dead API as a connection problem rather than a room problem', () => {
    expect(messageForError(new TypeError('Failed to fetch'))).toContain('Không kết nối được');
  });
});
