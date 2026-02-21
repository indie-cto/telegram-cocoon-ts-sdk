import { describe, it, expect } from 'vitest';
import {
  CocoonError,
  ConnectionError,
  ProtocolError,
  APIError,
  AuthenticationError,
  TimeoutError,
} from '../../src/core/error';

describe('CocoonError', () => {
  it('should have correct name', () => {
    const err = new CocoonError('test');
    expect(err.name).toBe('CocoonError');
  });

  it('should have correct message', () => {
    const err = new CocoonError('something went wrong');
    expect(err.message).toBe('something went wrong');
  });

  it('should be an instance of Error', () => {
    const err = new CocoonError('test');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ConnectionError', () => {
  it('should have correct name', () => {
    const err = new ConnectionError('conn failed');
    expect(err.name).toBe('ConnectionError');
  });

  it('should have correct message', () => {
    const err = new ConnectionError('conn failed');
    expect(err.message).toBe('conn failed');
  });

  it('should store cause', () => {
    const cause = new Error('underlying');
    const err = new ConnectionError('conn failed', cause);
    expect(err.cause).toBe(cause);
  });

  it('should have undefined cause when not provided', () => {
    const err = new ConnectionError('conn failed');
    expect(err.cause).toBeUndefined();
  });

  it('should extend CocoonError', () => {
    const err = new ConnectionError('test');
    expect(err).toBeInstanceOf(CocoonError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ProtocolError', () => {
  it('should have correct name', () => {
    const err = new ProtocolError('bad frame');
    expect(err.name).toBe('ProtocolError');
  });

  it('should store code', () => {
    const err = new ProtocolError('bad frame', 400);
    expect(err.code).toBe(400);
  });

  it('should have undefined code when not provided', () => {
    const err = new ProtocolError('bad frame');
    expect(err.code).toBeUndefined();
  });

  it('should extend CocoonError', () => {
    const err = new ProtocolError('test');
    expect(err).toBeInstanceOf(CocoonError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('APIError', () => {
  it('should have correct name', () => {
    const err = new APIError('not found', 404);
    expect(err.name).toBe('APIError');
  });

  it('should store statusCode', () => {
    const err = new APIError('server error', 500);
    expect(err.statusCode).toBe(500);
  });

  it('should store errorBody', () => {
    const body = { error: 'detail' };
    const err = new APIError('bad request', 400, body);
    expect(err.errorBody).toEqual(body);
  });

  it('should have undefined errorBody when not provided', () => {
    const err = new APIError('error', 500);
    expect(err.errorBody).toBeUndefined();
  });

  it('should extend CocoonError', () => {
    const err = new APIError('test', 500);
    expect(err).toBeInstanceOf(CocoonError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('AuthenticationError', () => {
  it('should have correct name', () => {
    const err = new AuthenticationError('auth failed');
    expect(err.name).toBe('AuthenticationError');
  });

  it('should store code', () => {
    const err = new AuthenticationError('auth failed', 401);
    expect(err.code).toBe(401);
  });

  it('should have undefined code when not provided', () => {
    const err = new AuthenticationError('auth failed');
    expect(err.code).toBeUndefined();
  });

  it('should extend CocoonError', () => {
    const err = new AuthenticationError('test');
    expect(err).toBeInstanceOf(CocoonError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('TimeoutError', () => {
  it('should have correct name', () => {
    const err = new TimeoutError();
    expect(err.name).toBe('TimeoutError');
  });

  it('should have default message', () => {
    const err = new TimeoutError();
    expect(err.message).toBe('Request timed out');
  });

  it('should accept custom message', () => {
    const err = new TimeoutError('custom timeout');
    expect(err.message).toBe('custom timeout');
  });

  it('should extend CocoonError', () => {
    const err = new TimeoutError();
    expect(err).toBeInstanceOf(CocoonError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('instanceof checks across hierarchy', () => {
  it('ConnectionError instanceof chain', () => {
    const err = new ConnectionError('test');
    expect(err instanceof ConnectionError).toBe(true);
    expect(err instanceof CocoonError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(err instanceof APIError).toBe(false);
  });

  it('APIError instanceof chain', () => {
    const err = new APIError('test', 500);
    expect(err instanceof APIError).toBe(true);
    expect(err instanceof CocoonError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ConnectionError).toBe(false);
  });

  it('TimeoutError instanceof chain', () => {
    const err = new TimeoutError();
    expect(err instanceof TimeoutError).toBe(true);
    expect(err instanceof CocoonError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ProtocolError).toBe(false);
  });
});
