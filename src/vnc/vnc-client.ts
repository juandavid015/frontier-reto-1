import { vncConfig } from './config.ts';
import { Framebuffer, type Frame } from './framebuffer.ts';
import { BYTES_PER_COLOUR_MAP_ENTRY, ClientMessage, Encoding, ServerMessage } from './rfb-protocol.ts';
import { performHandshake } from './rfb-handshake.ts';
import { withTimeout } from './timeout.ts';
import { openWebSocketTransport, type Transport } from './websocket-transport.ts';

// One VNC session with a remote desktop: log in, keep a copy of the screen, hand out screenshots.
// After the handshake a single loop reads every server message, so the byte stream is never read from two places.

export type VncConnectOptions = {
  url: string;
  password: string;
};

type UpdateWaiter = {
  resolve: (frame: Frame) => void;
  reject: (error: Error) => void;
};

export class VncClient {
  readonly serverName: string;
  #transport: Transport;
  #framebuffer: Framebuffer;
  #updateWaiters: UpdateWaiter[] = [];
  #failure: Error | undefined;
  #closed = false;

  private constructor(transport: Transport, serverName: string, width: number, height: number) {
    this.#transport = transport;
    this.serverName = serverName;
    this.#framebuffer = new Framebuffer(width, height);
  }

  static async connect(options: VncConnectOptions): Promise<VncClient> {
    const transport = await openWebSocketTransport(options.url, {
      subprotocols: vncConfig.webSocketSubprotocols,
      connectTimeoutMs: vncConfig.connectTimeoutMs,
    });
    try {
      const init = await withTimeout(
        performHandshake(transport, options.password),
        vncConfig.handshakeTimeoutMs,
        'VNC login',
      );
      const client = new VncClient(transport, init.name, init.width, init.height);
      void client.#readServerMessages();
      return client;
    } catch (error) {
      transport.close();
      throw error;
    }
  }

  get width(): number {
    return this.#framebuffer.width;
  }

  get height(): number {
    return this.#framebuffer.height;
  }

  /** Asks for the whole screen and resolves when the server has sent it. */
  async captureScreen(): Promise<Frame> {
    if (this.#failure) throw this.#failure;
    const nextUpdate = new Promise<Frame>((resolve, reject) => this.#updateWaiters.push({ resolve, reject }));
    this.#requestUpdate(false);
    return withTimeout(nextUpdate, vncConfig.screenshotTimeoutMs, 'Screenshot');
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#transport.close();
    this.#failAll(new Error('VNC connection closed by us'));
  }

  #requestUpdate(incremental: boolean): void {
    const message = Buffer.alloc(10);
    message.writeUInt8(ClientMessage.framebufferUpdateRequest, 0);
    message.writeUInt8(incremental ? 1 : 0, 1);
    message.writeUInt16BE(0, 2);
    message.writeUInt16BE(0, 4);
    message.writeUInt16BE(this.width, 6);
    message.writeUInt16BE(this.height, 8);
    this.#transport.send(message);
  }

  async #readServerMessages(): Promise<void> {
    try {
      for (;;) await this.#readServerMessage();
    } catch (error) {
      this.#failAll(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async #readServerMessage(): Promise<void> {
    const reader = this.#transport.reader;
    const type = await reader.readUint8();
    switch (type) {
      case ServerMessage.framebufferUpdate:
        await this.#readFramebufferUpdate();
        return;
      // We use none of the next three. Each is read to its end so the stream stays aligned.
      case ServerMessage.setColourMapEntries: {
        await reader.skip(3);
        const count = await reader.readUint16();
        await reader.skip(count * BYTES_PER_COLOUR_MAP_ENTRY);
        return;
      }
      case ServerMessage.bell:
        return;
      case ServerMessage.serverCutText: {
        await reader.skip(3);
        await reader.skip(await reader.readUint32());
        return;
      }
      default:
        throw new Error(`Desktop sent VNC message type ${type}, which we do not support`);
    }
  }

  async #readFramebufferUpdate(): Promise<void> {
    const reader = this.#transport.reader;
    await reader.skip(1);
    const rectangleCount = await reader.readUint16();
    for (let index = 0; index < rectangleCount; index++) {
      const x = await reader.readUint16();
      const y = await reader.readUint16();
      const width = await reader.readUint16();
      const height = await reader.readUint16();
      const encoding = await reader.readInt32();
      await this.#readRectangle(encoding, x, y, width, height);
    }
    this.#resolveWaiters();
  }

  async #readRectangle(encoding: number, x: number, y: number, width: number, height: number): Promise<void> {
    if (encoding === Encoding.desktopSize) {
      this.#framebuffer.resize(width, height);
      return;
    }
    if (encoding !== Encoding.raw) throw new Error(`Desktop sent encoding ${encoding}, which we did not ask for`);
    const bytesPerPixel = vncConfig.pixelFormat.bitsPerPixel / 8;
    const pixels = await this.#transport.reader.read(width * height * bytesPerPixel);
    this.#framebuffer.paintRaw(x, y, width, height, pixels);
  }

  #resolveWaiters(): void {
    const waiters = this.#updateWaiters;
    if (waiters.length === 0) return;
    this.#updateWaiters = [];
    const frame = this.#framebuffer.snapshot();
    for (const waiter of waiters) waiter.resolve(frame);
  }

  #failAll(error: Error): void {
    this.#failure ??= error;
    this.#transport.reader.fail(this.#failure);
    const waiters = this.#updateWaiters;
    this.#updateWaiters = [];
    for (const waiter of waiters) waiter.reject(this.#failure);
  }
}
