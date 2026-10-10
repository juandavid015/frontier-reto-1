import { vncConfig } from './config.ts';

// Our copy of the remote screen. Each update from the server paints a rectangle into it.

/** A screen image: 3 bytes per pixel (red, green, blue), rows top to bottom. */
export type Frame = {
  width: number;
  height: number;
  rgb: Buffer;
};

export const RGB_BYTES_PER_PIXEL = 3;

export class Framebuffer {
  #frame: Frame;

  constructor(width: number, height: number) {
    this.#frame = blankFrame(width, height);
  }

  get width(): number {
    return this.#frame.width;
  }

  get height(): number {
    return this.#frame.height;
  }

  /** The server changed the screen size; the old pixels no longer mean anything. */
  resize(width: number, height: number): void {
    this.#frame = blankFrame(width, height);
  }

  /**
   * Paints a raw-encoded rectangle. Pixels arrive in the format we set in config.ts. Returns whether any pixel
   * changed: servers often resend areas that look the same, and that must not count as the screen changing.
   */
  paintRaw(x: number, y: number, width: number, height: number, pixels: Buffer): boolean {
    const fitsOnScreen = x + width <= this.#frame.width && y + height <= this.#frame.height;
    if (!fitsOnScreen) {
      throw new Error(`Rectangle ${width}x${height} at ${x},${y} is outside the ${this.width}x${this.height} screen`);
    }
    const format = vncConfig.pixelFormat;
    const bytesPerPixel = format.bitsPerPixel / 8;
    const { rgb } = this.#frame;
    let changed = false;
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const pixel = pixels.readUInt32LE((row * width + column) * bytesPerPixel);
        const target = ((y + row) * this.#frame.width + x + column) * RGB_BYTES_PER_PIXEL;
        const red = (pixel >>> format.redShift) & format.redMax;
        const green = (pixel >>> format.greenShift) & format.greenMax;
        const blue = (pixel >>> format.blueShift) & format.blueMax;
        const differs = rgb[target] !== red || rgb[target + 1] !== green || rgb[target + 2] !== blue;
        if (!differs) continue;
        changed = true;
        rgb[target] = red;
        rgb[target + 1] = green;
        rgb[target + 2] = blue;
      }
    }
    return changed;
  }

  /** A copy, so later updates do not change a screenshot already taken. */
  snapshot(): Frame {
    return { ...this.#frame, rgb: Buffer.from(this.#frame.rgb) };
  }
}

function blankFrame(width: number, height: number): Frame {
  return { width, height, rgb: Buffer.alloc(width * height * RGB_BYTES_PER_PIXEL) };
}
