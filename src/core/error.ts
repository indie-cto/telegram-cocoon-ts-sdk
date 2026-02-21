/**
 * Error classes for the Cocoon SDK.
 */

export class CocoonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CocoonError';
  }
}

export class ConnectionError extends CocoonError {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'ConnectionError';
  }
}

export class ProtocolError extends CocoonError {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export class APIError extends CocoonError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorBody?: unknown,
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export class AuthenticationError extends CocoonError {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class TimeoutError extends CocoonError {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}
