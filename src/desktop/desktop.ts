import { setTimeout as sleep } from 'node:timers/promises';
import type { Frame } from '../vnc/framebuffer.ts';
import { PointerButton } from '../vnc/rfb-protocol.ts';
import { VncClient, type VncConnectOptions } from '../vnc/vnc-client.ts';
import { desktopConfig } from './config.ts';
import { NAMED_KEYS, isKeyName, keysymForCharacter, type KeyName } from './keysyms.ts';

// The driver's hands and eyes on one remote desktop. Every action waits until the screen stops changing, so the
// next screenshot shows the result of the action and not the screen before it.

export type ActionResult = {
  /** False when no pixel changed: the action probably had no effect. */
  changed: boolean;
  /** True when the screen was still changing at the cap. */
  stillChanging: boolean;
  /** From the end of the input to the screen being stable. */
  waitedMs: number;
};

export type ScrollDirection = 'up' | 'down';

export class Desktop {
  #client: VncClient;

  private constructor(client: VncClient) {
    this.#client = client;
  }

  static async connect(options: VncConnectOptions): Promise<Desktop> {
    return new Desktop(await VncClient.connect(options));
  }

  get width(): number {
    return this.#client.width;
  }

  get height(): number {
    return this.#client.height;
  }

  screenshot(): Frame {
    return this.#client.screenshot();
  }

  async click(x: number, y: number): Promise<ActionResult> {
    this.#assertOnScreen(x, y);
    const startedAt = performance.now();
    this.#client.sendPointer(x, y, PointerButton.none);
    this.#client.sendPointer(x, y, PointerButton.left);
    await sleep(desktopConfig.clickHoldMs);
    this.#client.sendPointer(x, y, PointerButton.none);
    return this.waitForStableScreen(startedAt);
  }

  /** One wheel step per `steps`, with the pointer at (x, y) so the right panel scrolls. */
  async scroll(x: number, y: number, direction: ScrollDirection, steps: number): Promise<ActionResult> {
    this.#assertOnScreen(x, y);
    const startedAt = performance.now();
    const wheel = direction === 'up' ? PointerButton.wheelUp : PointerButton.wheelDown;
    for (let step = 0; step < steps; step++) {
      this.#client.sendPointer(x, y, wheel);
      this.#client.sendPointer(x, y, PointerButton.none);
      await sleep(desktopConfig.keyDelayMs);
    }
    return this.waitForStableScreen(startedAt);
  }

  /** Types text into whatever has focus. It does not clear the field first: see replaceText. */
  async typeText(text: string): Promise<ActionResult> {
    const characters = [...text].map((character) => ({ keysym: keysymForCharacter(character), character }));
    const startedAt = performance.now();
    for (const { keysym, character } of characters) {
      const delayMs = isPlainAscii(character) ? desktopConfig.keyDelayMs : desktopConfig.remappedKeyDelayMs;
      await this.#key(keysym, true, delayMs);
      await this.#key(keysym, false, delayMs);
    }
    return this.waitForStableScreen(startedAt);
  }

  /** The brief: typing into a field that has text appends to it, so select everything first. */
  async replaceText(text: string): Promise<ActionResult> {
    await this.pressKeys(['Control', 'a']);
    return this.typeText(text);
  }

  /** Holds the keys down in order and releases them in reverse: ['Control', 'a'] is select all. */
  async pressKeys(keys: Array<KeyName | string>): Promise<ActionResult> {
    const keysyms = keys.map(keysymForKey);
    const startedAt = performance.now();
    for (const keysym of keysyms) await this.#key(keysym, true);
    for (const keysym of keysyms.toReversed()) await this.#key(keysym, false);
    return this.waitForStableScreen(startedAt);
  }

  /**
   * Waits for the screen to settle after an action that started at `actionStartedAt`. Any change since then counts.
   * The timers start when the input ends, so typing a long text does not use up the wait. Two phases: wait up to
   * firstChangeTimeoutMs for any change; once changes start, wait until none has come for quietMs.
   */
  async waitForStableScreen(actionStartedAt: number): Promise<ActionResult> {
    const { firstChangeTimeoutMs, quietMs, maxWaitMs, pollMs } = desktopConfig.stable;
    const inputEndedAt = performance.now();
    for (;;) {
      this.#client.screenshot(); // Throws if the connection died, instead of waiting out the cap.
      const now = performance.now();
      const changed = this.#client.lastChangeAt > actionStartedAt;
      const waitedMs = Math.round(now - inputEndedAt);
      if (!changed && waitedMs >= firstChangeTimeoutMs) return { changed, stillChanging: false, waitedMs };
      if (changed && now - this.#client.lastChangeAt >= quietMs) return { changed, stillChanging: false, waitedMs };
      if (waitedMs >= maxWaitMs) return { changed, stillChanging: true, waitedMs };
      await sleep(pollMs);
    }
  }

  close(): void {
    this.#client.close();
  }

  async #key(keysym: number, down: boolean, delayMs = desktopConfig.keyDelayMs): Promise<void> {
    this.#client.sendKey(keysym, down);
    await sleep(delayMs);
  }

  #assertOnScreen(x: number, y: number): void {
    const isOnScreen =
      Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
    if (!isOnScreen) throw new Error(`Point (${x}, ${y}) is outside the ${this.width}x${this.height} screen`);
  }
}

const LAST_PLAIN_ASCII = 0x7e;

function isPlainAscii(character: string): boolean {
  return character.codePointAt(0)! <= LAST_PLAIN_ASCII;
}

function keysymForKey(key: string): number {
  return isKeyName(key) ? NAMED_KEYS[key] : keysymForCharacter(key);
}
