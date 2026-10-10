import { ByteReader } from './byte-reader.ts';
import { withTimeout } from './timeout.ts';

// Carries the VNC byte stream over the desktop's websocket (websockify). Uses the WebSocket client built into Node,
// so there is no dependency and no local TCP bridge.

export type Transport = {
  readonly reader: ByteReader;
  send(bytes: Buffer): void;
  close(): void;
};

export type WebSocketOptions = {
  subprotocols: string[];
  connectTimeoutMs: number;
};

export async function openWebSocketTransport(url: string, options: WebSocketOptions): Promise<Transport> {
  const reader = new ByteReader();
  const socket = new WebSocket(url, options.subprotocols);
  socket.binaryType = 'arraybuffer';

  socket.addEventListener('message', (event) => {
    if (!(event.data instanceof ArrayBuffer)) {
      reader.fail(new Error('Desktop sent a text websocket message; VNC over websockify must be binary'));
      return;
    }
    reader.push(Buffer.from(event.data));
  });
  socket.addEventListener('close', (event) => {
    reader.fail(new Error(`Desktop connection closed (code ${event.code}${event.reason ? `, ${event.reason}` : ''})`));
  });

  try {
    await withTimeout(waitForOpen(socket), options.connectTimeoutMs, 'Opening the desktop websocket');
  } catch (error) {
    socket.close();
    throw error;
  }

  return {
    reader,
    send: (bytes) => socket.send(bytes),
    close: () => socket.close(),
  };
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    // Node's WebSocket fires an ErrorEvent whose message is the only clue to why the handshake failed.
    socket.addEventListener(
      'error',
      (event) => {
        const cause = 'message' in event && typeof event.message === 'string' ? `: ${event.message}` : '';
        reject(new Error(`Could not open the desktop websocket${cause}`));
      },
      { once: true },
    );
  });
}
