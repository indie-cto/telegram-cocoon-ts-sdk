/**
 * Stream<T> — an async iterable wrapper for streaming responses.
 * Follows the OpenAI SDK pattern.
 */

export class Stream<T> implements AsyncIterable<T> {
  private controller: ReadableStreamDefaultController<T> | null = null;
  private stream: ReadableStream<T>;
  private _done = false;

  constructor() {
    this.stream = new ReadableStream<T>({
      start: (controller) => {
        this.controller = controller;
      },
    });
  }

  /**
   * Push a chunk into the stream.
   */
  push(chunk: T): void {
    if (this._done) return;
    this.controller?.enqueue(chunk);
  }

  /**
   * Signal that the stream is complete.
   */
  end(): void {
    if (this._done) return;
    this._done = true;
    this.controller?.close();
  }

  /**
   * Signal an error on the stream.
   */
  error(err: Error): void {
    if (this._done) return;
    this._done = true;
    this.controller?.error(err);
  }

  get done(): boolean {
    return this._done;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    const reader = this.stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
}
