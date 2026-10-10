import { vncConfig } from './config.ts';
import { Framebuffer, type Frame } from './framebuffer.ts';
import { BYTES_PER_COLOUR_MAP_ENTRY, ClientMessage, Encoding, ServerMessage } from './rfb-protocol.ts';
import { performHandshake } from './rfb-handshake.ts';
import { withTimeout } from './timeout.ts';
import { openWebSocketTransport, type Transport } from './websocket-transport.ts';

// One VNC session with a remote desktop: log in, keep a live copy of the screen, send mouse and key events.
// After the handshake a single loop reads every server message, so the byte stream is never read from two places.
// Like noVNC, we ask for the next round of changes as soon as one arrives. The copy is then always current, a
// screenshot needs no network trip, and "has the screen stopped changing" is a question about local state.

export type VncConnectOptions = {
  url: string;
  password: string;
};

export class VncClient {
  readonly serverName: string;
  #transport: Transport;
  #framebuffer: Framebuffer;
  // performance.now() of the last update that changed at least one pixel.
  #lastChangeAt = 0;
  #updateListeners: Array<() => void> = [];
  #failure: Error | undefined;
  #closed = false;
  // Full-screen refreshes run one at a time (NOTES.md decision 3), so two callers never wait on the same update.
  #refreshQueue: Promise<unknown> = Promise.resolve();

  private constructor(transport: Transport, serverName: string, width: number, height: number) {
    this.#transport = transport;
    this.serverName = serverName;
    this.#framebuffer = new Framebuffer(width, height);
  }

  static async connect(options: VncConnectOptions): Promise<VncClient> {
    const transport = await openWebSocketTransport(options.url, {
      subprotocols: vncConfig.webSocketSubprotocols,
      connectTimeoutMs: vncConfig.connectTimeoutMs,
      maxReadBytes: vncConfig.maxReadBytes,
    });
    try {
      const init = await withTimeout(
        performHandshake(transport, options.password),
        vncConfig.handshakeTimeoutMs,
        'VNC login',
      );
      const client = new VncClient(transport, init.name, init.width, init.height);
      void client.#readServerMessages();
      await client.refreshScreen();
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

  get lastChangeAt(): number {
    return this.#lastChangeAt;
  }

  /** The screen as we know it right now. No network trip. */
  screenshot(): Frame {
    this.#throwIfFailed();
    return this.#framebuffer.snapshot();
  }

  /** Asks the server to resend the whole screen and resolves after the next update. */
  refreshScreen(): Promise<Frame> {
    const refresh = this.#refreshQueue.then(() => this.#refreshOnce());
    this.#refreshQueue = refresh.catch(() => undefined);
    return refresh;
  }

  /** PointerEvent, RFC 6143 section 7.5.5. `buttons` is a mask from PointerButton. */
  sendPointer(x: number, y: number, buttons: number): void {
    this.#throwIfFailed();
    const message = Buffer.alloc(6);
    message.writeUInt8(ClientMessage.pointerEvent, 0);
    message.writeUInt8(buttons, 1);
    message.writeUInt16BE(x, 2);
    message.writeUInt16BE(y, 4);
    this.#transport.send(message);
  }

  /** KeyEvent, RFC 6143 section 7.5.4. `keysym` is an X11 keysym. */
  sendKey(keysym: number, down: boolean): void {
    this.#throwIfFailed();
    const message = Buffer.alloc(8);
    message.writeUInt8(ClientMessage.keyEvent, 0);
    message.writeUInt8(down ? 1 : 0, 1);
    message.writeUInt32BE(keysym, 4);
    this.#transport.send(message);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#transport.close();
    this.#fail(new Error('VNC connection closed by us'));
  }

  async #refreshOnce(): Promise<Frame> {
    this.#throwIfFailed();
    const nextUpdate = this.#nextUpdate();
    this.#requestUpdate(false);
    await withTimeout(nextUpdate, vncConfig.screenshotTimeoutMs, 'Screen refresh');
    return this.screenshot();
  }

  #nextUpdate(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#updateListeners.push(() => (this.#failure ? reject(this.#failure) : resolve()));
    });
  }

  // A browser-style WebSocket silently drops what is sent after it closes, so we refuse instead.
  #throwIfFailed(): void {
    if (this.#failure) throw this.#failure;
  }

  #requestUpdate(incremental: boolean): void {
    if (this.#failure) return;
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
      this.#fail(error instanceof Error ? error : new Error(String(error)));
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
    let changed = false;
    for (let index = 0; index < rectangleCount; index++) {
      const x = await reader.readUint16();
      const y = await reader.readUint16();
      const width = await reader.readUint16();
      const height = await reader.readUint16();
      const encoding = await reader.readInt32();
      const rectangleChanged = await this.#readRectangle(encoding, x, y, width, height);
      changed ||= rectangleChanged;
    }
    if (changed) this.#lastChangeAt = performance.now();
    this.#notifyUpdate();
    this.#askForNextChanges(rectangleCount === 0);
  }

  async #readRectangle(encoding: number, x: number, y: number, width: number, height: number): Promise<boolean> {
    const bytesPerPixel = vncConfig.pixelFormat.bitsPerPixel / 8;
    const reader = this.#transport.reader;
    switch (encoding) {
      case Encoding.raw:
        return this.#framebuffer.paintRaw(x, y, width, height, await reader.read(width * height * bytesPerPixel));
      case Encoding.desktopSize:
        this.#framebuffer.resize(width, height);
        return true;
      case Encoding.cursor: {
        // Pointer shape: its pixels, then a bitmask with one bit per pixel and rows padded to whole bytes.
        const maskBytes = Math.ceil(width / 8) * height;
        await reader.skip(width * height * bytesPerPixel + maskBytes);
        return false;
      }
      default:
        throw new Error(`Desktop sent encoding ${encoding}, which we did not ask for`);
    }
  }

  #askForNextChanges(updateWasEmpty: boolean): void {
    if (!updateWasEmpty) {
      this.#requestUpdate(true);
      return;
    }
    setTimeout(() => this.#requestUpdate(true), vncConfig.emptyUpdateRetryMs).unref();
  }

  #notifyUpdate(): void {
    const listeners = this.#updateListeners;
    this.#updateListeners = [];
    for (const listener of listeners) listener();
  }

  #fail(error: Error): void {
    this.#failure ??= error;
    this.#transport.reader.fail(this.#failure);
    this.#notifyUpdate();
  }
}
