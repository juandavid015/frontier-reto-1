import type { ByteReader } from './byte-reader.ts';
import { vncConfig } from './config.ts';
import {
  CLIENT_MINOR_VERSION,
  ClientMessage,
  Encoding,
  MIN_MINOR_VERSION,
  PIXEL_FORMAT_LENGTH,
  PROTOCOL_VERSION_LENGTH,
  SECURITY_RESULT_OK,
  SHARED_FLAG,
  SecurityType,
  VNC_CHALLENGE_LENGTH,
} from './rfb-protocol.ts';
import { vncAuthResponse } from './vnc-auth.ts';
import type { Transport } from './websocket-transport.ts';

// The opening of an RFB session, RFC 6143 sections 7.1 to 7.3: agree a version, log in, exchange init messages,
// then tell the server which pixel format and encodings we understand.

export type ServerInit = {
  width: number;
  height: number;
  name: string;
};

export async function performHandshake(transport: Transport, password: string): Promise<ServerInit> {
  const { reader } = transport;
  const minorVersion = await negotiateVersion(transport);
  const securityType = await negotiateSecurity(transport, minorVersion);
  if (securityType === SecurityType.vncAuthentication) {
    const challenge = await reader.read(VNC_CHALLENGE_LENGTH);
    transport.send(vncAuthResponse(challenge, password));
  }
  await readSecurityResult(reader, minorVersion, securityType);

  transport.send(Buffer.from([SHARED_FLAG]));
  const serverInit = await readServerInit(reader);
  transport.send(setPixelFormatMessage());
  transport.send(setEncodingsMessage([Encoding.raw, Encoding.desktopSize]));
  return serverInit;
}

// Example: the server sends "RFB 003.008\n"; we answer with the same and speak 3.8.
async function negotiateVersion(transport: Transport): Promise<number> {
  const announced = (await transport.reader.read(PROTOCOL_VERSION_LENGTH)).toString('latin1');
  const match = /^RFB (\d{3})\.(\d{3})\n$/.exec(announced);
  if (!match) throw new Error(`Desktop did not speak VNC (it sent ${JSON.stringify(announced)})`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major !== 3 || minor < MIN_MINOR_VERSION) throw new Error(`Unsupported VNC version ${major}.${minor}`);

  const agreedMinor = agreeMinorVersion(minor);
  transport.send(Buffer.from(`RFB 003.00${agreedMinor}\n`, 'latin1'));
  return agreedMinor;
}

function agreeMinorVersion(serverMinor: number): number {
  if (serverMinor >= CLIENT_MINOR_VERSION) return CLIENT_MINOR_VERSION;
  if (serverMinor === 7) return 7;
  // RFC 6143 section 7.1.1: versions 3.4 to 3.6 must be treated as 3.3.
  return MIN_MINOR_VERSION;
}

async function negotiateSecurity(transport: Transport, minorVersion: number): Promise<number> {
  const { reader } = transport;
  // Version 3.3: the server picks the type alone and sends it as a 32-bit number.
  if (minorVersion === 3) {
    const chosen = await reader.readUint32();
    if (chosen === SecurityType.invalid) throw new Error(`Desktop refused the connection: ${await readReason(reader)}`);
    return chosen;
  }

  const count = await reader.readUint8();
  if (count === 0) throw new Error(`Desktop refused the connection: ${await readReason(reader)}`);
  const offered = [...(await reader.read(count))];
  const chosen = [SecurityType.vncAuthentication, SecurityType.none].find((type) => offered.includes(type));
  if (chosen === undefined) throw new Error(`Desktop offers no login method we support (offered: ${offered})`);
  transport.send(Buffer.from([chosen]));
  return chosen;
}

async function readSecurityResult(reader: ByteReader, minorVersion: number, securityType: number): Promise<void> {
  // Before 3.8 the server sends no result when there is no password.
  const resultIsSent = minorVersion >= CLIENT_MINOR_VERSION || securityType !== SecurityType.none;
  if (!resultIsSent) return;
  const result = await reader.readUint32();
  if (result === SECURITY_RESULT_OK) return;
  const reason = minorVersion >= CLIENT_MINOR_VERSION ? `: ${await readReason(reader)}` : '';
  throw new Error(`Desktop rejected the VNC login (wrong password?)${reason}`);
}

async function readServerInit(reader: ByteReader): Promise<ServerInit> {
  const width = await reader.readUint16();
  const height = await reader.readUint16();
  // The server's own pixel format is ignored: we set ours right after.
  await reader.skip(PIXEL_FORMAT_LENGTH);
  const nameLength = await reader.readUint32();
  const name = (await reader.read(nameLength)).toString('utf8');
  return { width, height, name };
}

async function readReason(reader: ByteReader): Promise<string> {
  const length = await reader.readUint32();
  return (await reader.read(length)).toString('utf8');
}

function setPixelFormatMessage(): Buffer {
  const format = vncConfig.pixelFormat;
  const message = Buffer.alloc(4 + PIXEL_FORMAT_LENGTH);
  message.writeUInt8(ClientMessage.setPixelFormat, 0);
  message.writeUInt8(format.bitsPerPixel, 4);
  message.writeUInt8(format.depth, 5);
  message.writeUInt8(format.bigEndian ? 1 : 0, 6);
  message.writeUInt8(format.trueColour ? 1 : 0, 7);
  message.writeUInt16BE(format.redMax, 8);
  message.writeUInt16BE(format.greenMax, 10);
  message.writeUInt16BE(format.blueMax, 12);
  message.writeUInt8(format.redShift, 14);
  message.writeUInt8(format.greenShift, 15);
  message.writeUInt8(format.blueShift, 16);
  return message;
}

function setEncodingsMessage(encodings: number[]): Buffer {
  const message = Buffer.alloc(4 + 4 * encodings.length);
  message.writeUInt8(ClientMessage.setEncodings, 0);
  message.writeUInt16BE(encodings.length, 2);
  encodings.forEach((encoding, index) => message.writeInt32BE(encoding, 4 + 4 * index));
  return message;
}
