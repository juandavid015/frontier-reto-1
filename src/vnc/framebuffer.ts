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

  /** Paints a raw-encoded rectangle. Pixels arrive in the format we set in config.ts. */
  paintRaw(x: number, y: number, width: number, height: number, pixels: Buffer): void {
    const fitsOnScreen = x + width <= this.#frame.width && y + height <= this.#frame.height;
    if (!fitsOnScreen) {
      throw new Error(`Rectangle ${width}x${height} at ${x},${y} is outside the ${this.width}x${this.height} screen`);
    }
    const format = vncConfig.pixelFormat;
    const bytesPerPixel = format.bitsPerPixel / 8;
    const { rgb } = this.#frame;
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const pixel = pixels.readUInt32LE((row * width + column) * bytesPerPixel);
        const target = ((y + row) * this.#frame.width + x + column) * RGB_BYTES_PER_PIXEL;
        rgb[target] = (pixel >>> format.redShift) & format.redMax;
        rgb[target + 1] = (pixel >>> format.greenShift) & format.greenMax;
        rgb[target + 2] = (pixel >>> format.blueShift) & format.blueMax;
      }
    }
  }

  /** A copy, so later updates do not change a screenshot already taken. */
  snapshot(): Frame {
    return { ...this.#frame, rgb: Buffer.from(this.#frame.rgb) };
  }
}

function blankFrame(width: number, height: number): Frame {
  return { width, height, rgb: Buffer.alloc(width * height * RGB_BYTES_PER_PIXEL) };
}
