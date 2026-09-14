import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../db/repositories/index.js';
import { badRequest, errorBody, HttpError, notFound, toHttpError } from './errors.js';

describe('toHttpError', () => {
  it('passes an HttpError through unchanged', () => {
    const original = notFound('room not found');

    expect(toHttpError(original)).toBe(original);
  });

  it('maps a data-layer ValidationError onto 400', () => {
    const mapped = toHttpError(new ValidationError('room name must not be empty'));

    expect(mapped).toMatchObject({
      status: 400,
      code: 'validation_error',
      message: 'room name must not be empty',
    });
  });

  it('maps a data-layer ConflictError onto 409', () => {
    expect(toHttpError(new ConflictError('taken'))).toMatchObject({
      status: 409,
      code: 'conflict',
    });
  });

  it('maps the SyntaxError express.json() throws onto 400', () => {
    const parseFailure = Object.assign(new SyntaxError('Unexpected token'), { body: '{oops' });

    expect(toHttpError(parseFailure)).toMatchObject({ status: 400, code: 'validation_error' });
  });

  it('does not leak an unexpected error to the caller', () => {
    const mapped = toHttpError(new Error('connection terminated: password authentication failed'));

    expect(mapped).toMatchObject({ status: 500, code: 'internal' });
    expect(mapped.message).toBe('internal server error');
  });
});

describe('error constructors', () => {
  it('builds a 400 and a 404 with the documented codes', () => {
    expect(badRequest('nope')).toBeInstanceOf(HttpError);
    expect(badRequest('nope')).toMatchObject({ status: 400, code: 'validation_error' });
    expect(notFound('nope')).toMatchObject({ status: 404, code: 'not_found' });
  });

  it('wraps the body in the shape the web client switches on', () => {
    expect(errorBody('not_found', 'room not found')).toEqual({
      error: { code: 'not_found', message: 'room not found' },
    });
  });
});
