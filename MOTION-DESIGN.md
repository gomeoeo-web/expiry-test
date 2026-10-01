# UI motion design

The header and bottom navigation follow actual document scrolling without fading, sliding out on upward swipes and returning on downward swipes; empty pages and overscroll cannot hide it. A partial header settles to an endpoint after release or scroll end. Small direction changes use a 10px intent threshold. Focus, modal interaction and returning to the top reveal the header. Resizing preserves its progress.

## Rhythm

- Controls: 70ms press, 120ms release; scale 0.985 for buttons and 0.995 for cards. Dock buttons retain their size. Use one scale owner, never stack transform scaling with the scale property.
- Pages: 320ms cubic deceleration. The selection pill follows actual page travel. Incoming pages stay opaque. New tab clicks reset document scroll before changing panel heights; tapping the current tab scrolls to the top.
- Dialogs: 300ms entry with 16px travel and scale 0.985; 220ms exit with 12px travel. The dimming layer animates its background independently of the content.
- Bottom sheets: 300ms entry, 220ms exit. Keep the sheet fully opaque. Dragging follows the pointer immediately; cancellation returns over 260ms. Dismiss beyond 64px, or beyond 24px with downward velocity above 0.45px/ms.
- Animation interruptions retain the current position, including closing during entry and regrabbing a rebound. The dimming layer also exits from its current color.
- Reduced motion removes CSS travel durations and press scaling. Completion and background unlocking still follow animation promises.

## Ownership and validation

CSS motion tokens live in `theme-overrides.css`. Header and horizontal page movement live in `index.html`. Modal drag, interruption and completion live in `sheet-gestures.js`. Build copies these sources into `www`; edit source files rather than generated copies.

Run `node --test tests/navigation_settle.test.mjs tests/gesture_smoothness.test.mjs tests/modal_gestures.test.mjs` and `node tests/pending-browser.cjs`. These cover actual scroll movement, empty-page gestures, reversal, dock hide/reveal endpoints, rapid tab switching, solid overlay surfaces, closing during entry, drag cancellation, content scrolling and background locking.

Browser checks use Edge mobile emulation. iOS WebKit, safe-area changes and device refresh-rate behavior still require physical-device verification.
