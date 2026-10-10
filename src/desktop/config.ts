// Timing of the driver's hands. The brief measured the desktop: a click held under 100 ms is ignored, and a repaint
// can take up to 1 second after a click.

export const desktopConfig = {
  // Above the 100 ms the brief says is ignored, with margin for network jitter.
  clickHoldMs: 120,
  // Pause between key events, so the remote app sees each key as typed rather than as a burst.
  keyDelayMs: 15,
  // Characters outside plain ASCII (á, Ñ, ¿) have no key on the remote keyboard; the server maps one on the fly and
  // the app needs time to see the new mapping. At 15 ms some were lost; at 80 ms none were (NOTES.md, E3).
  remappedKeyDelayMs: 80,
  // How we decide the screen stopped changing after an action. See waitForStableScreen in desktop.ts.
  stable: {
    // If nothing changes within this time, the action had no visible effect. Above the brief's 1 s repaint delay.
    firstChangeTimeoutMs: 1_500,
    // Once changes start, the screen is stable after this long with no change.
    quietMs: 400,
    // Hard cap, for screens that never stop changing (a spinner, a blinking caret).
    maxWaitMs: 5_000,
    pollMs: 50,
  },
};
