# NextSet Sleep face

Brandon approved this square gold bezel, green reptile eye and wide vertical pupil. Use these native 176×176 PNGs as source artwork.

Play open → closing (50 ms) → nearly closed (40 ms) → closed (70 ms) → nearly closed (50 ms) → closing (60 ms) → open. The frame pack reuses the same images in reverse when reopening. The bezel and display brightness stay fixed.

Blink once on entry, then every 30–90 seconds while the LCD is on. Never turn on the LCD or backlight to blink. Cancel pending frame and blink timers on LCD-off or exit, and restore the open frame on return. Sleep Log continues in the background.

Claude implementation: convert these assets to the watch's supported image format, preserve their appearance on the 176×176 display, and verify the animation, sleep-mode transitions, logging, and battery on a physical Bangle.js 2. Review the exact implementation commit with Codex.

See [issue #198](https://github.com/DrZaff/ai-medicine-collective/issues/198) for Run / Walk and the approved activity UI.
