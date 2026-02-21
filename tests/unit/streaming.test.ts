import { describe, it, expect } from 'vitest';
import { Stream } from '../../src/core/streaming';

describe('Stream', () => {
  it('should yield pushed chunks', async () => {
    const stream = new Stream<number>();

    // Push some chunks
    stream.push(1);
    stream.push(2);
    stream.push(3);
    stream.end();

    const results: number[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it('should handle empty stream', async () => {
    const stream = new Stream<number>();
    stream.end();

    const results: number[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results).toEqual([]);
  });

  it('should handle async push', async () => {
    const stream = new Stream<string>();

    // Push asynchronously
    setTimeout(() => {
      stream.push('hello');
      stream.push('world');
      stream.end();
    }, 10);

    const results: string[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results).toEqual(['hello', 'world']);
  });

  it('should propagate errors', async () => {
    const stream = new Stream<number>();

    setTimeout(() => {
      stream.push(1);
      stream.error(new Error('test error'));
    }, 10);

    const results: number[] = [];
    let caughtError: Error | null = null;

    try {
      for await (const chunk of stream) {
        results.push(chunk);
      }
    } catch (e) {
      caughtError = e as Error;
    }

    expect(results).toEqual([1]);
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe('test error');
  });

  it('should report done status', () => {
    const stream = new Stream<number>();
    expect(stream.done).toBe(false);
    stream.end();
    expect(stream.done).toBe(true);
  });

  it('should ignore pushes after end', async () => {
    const stream = new Stream<number>();
    stream.push(1);
    stream.end();
    stream.push(2); // should be ignored

    const results: number[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results).toEqual([1]);
  });

  it('should ignore pushes after error', async () => {
    const stream = new Stream<number>();

    // Push asynchronously to allow the reader to consume before error
    setTimeout(() => {
      stream.push(1);
      stream.error(new Error('fail'));
      stream.push(2); // should be ignored since done=true after error
    }, 10);

    const results: number[] = [];
    let caughtError: Error | null = null;
    try {
      for await (const chunk of stream) {
        results.push(chunk);
      }
    } catch (e) {
      caughtError = e as Error;
    }

    expect(results).toEqual([1]);
    expect(caughtError?.message).toBe('fail');
  });

  it('should ignore error after end', () => {
    const stream = new Stream<number>();
    stream.end();
    // Should not throw
    stream.error(new Error('too late'));
    expect(stream.done).toBe(true);
  });

  it('should handle large number of chunks', async () => {
    const stream = new Stream<number>();
    const count = 1000;

    setTimeout(() => {
      for (let i = 0; i < count; i++) {
        stream.push(i);
      }
      stream.end();
    }, 10);

    const results: number[] = [];
    for await (const chunk of stream) {
      results.push(chunk);
    }

    expect(results).toHaveLength(count);
    expect(results[0]).toBe(0);
    expect(results[count - 1]).toBe(count - 1);
  });

  it('should set done=true after error', () => {
    const stream = new Stream<number>();
    expect(stream.done).toBe(false);
    stream.error(new Error('boom'));
    expect(stream.done).toBe(true);
  });
});
