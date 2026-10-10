// Websocket messages split the VNC byte stream at arbitrary points: one message can hold half a header, or three
// server messages at once. The parser asks for exactly N bytes and waits until they have all arrived.

type PendingRead = {
  size: number;
  resolve: (bytes: Buffer) => void;
  reject: (error: Error) => void;
};

export class ByteReader {
  readonly #maxReadBytes: number;
  #chunks: Buffer[] = [];
  #bufferedLength = 0;
  #pending: PendingRead | undefined;
  #failure: Error | undefined;

  constructor(maxReadBytes: number) {
    this.#maxReadBytes = maxReadBytes;
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.#chunks.push(chunk);
    this.#bufferedLength += chunk.length;
    this.#settlePending();
  }

  /**
   * Ends the stream: a read that cannot be completed rejects with this error. Bytes that already arrived stay
   * readable, because a server that rejects a login sends its reason and closes right after.
   */
  fail(error: Error): void {
    this.#failure ??= error;
    const pending = this.#pending;
    this.#pending = undefined;
    pending?.reject(this.#failure);
  }

  read(size: number): Promise<Buffer> {
    if (this.#pending) return Promise.reject(new Error('ByteReader allows one read at a time'));
    if (size > this.#maxReadBytes) {
      return Promise.reject(new Error(`Desktop announced ${size} bytes, above our limit of ${this.#maxReadBytes}`));
    }
    if (this.#bufferedLength >= size) return Promise.resolve(this.#take(size));
    if (this.#failure) return Promise.reject(this.#failure);
    return new Promise((resolve, reject) => {
      this.#pending = { size, resolve, reject };
    });
  }

  async readUint8(): Promise<number> {
    return (await this.read(1)).readUInt8(0);
  }

  async readUint16(): Promise<number> {
    return (await this.read(2)).readUInt16BE(0);
  }

  async readUint32(): Promise<number> {
    return (await this.read(4)).readUInt32BE(0);
  }

  async readInt32(): Promise<number> {
    return (await this.read(4)).readInt32BE(0);
  }

  async skip(size: number): Promise<void> {
    await this.read(size);
  }

  #settlePending(): void {
    const pending = this.#pending;
    if (!pending || this.#bufferedLength < pending.size) return;
    this.#pending = undefined;
    pending.resolve(this.#take(pending.size));
  }

  // Slices without copying when the first chunk is big enough, which is the common case for small reads.
  #take(size: number): Buffer {
    const first = this.#chunks[0];
    if (first && first.length >= size) {
      this.#consumeFromFirst(first, size);
      return first.subarray(0, size);
    }
    const result = Buffer.allocUnsafe(size);
    let filled = 0;
    while (filled < size) {
      const chunk = this.#chunks[0]!;
      const count = Math.min(chunk.length, size - filled);
      chunk.copy(result, filled, 0, count);
      this.#consumeFromFirst(chunk, count);
      filled += count;
    }
    return result;
  }

  #consumeFromFirst(first: Buffer, count: number): void {
    this.#bufferedLength -= count;
    if (count === first.length) {
      this.#chunks.shift();
      return;
    }
    this.#chunks[0] = first.subarray(count);
  }
}
