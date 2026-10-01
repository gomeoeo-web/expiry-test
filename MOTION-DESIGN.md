# UI motion design

The header and bottom navigation follow actual document scrolling without fading, sliding out on upward swipes and returning on downward swipes; empty pages and overscroll cannot hide it. A 12px direction threshold starts an uninterrupted compositor transition to a complete endpoint: 380ms out and 300ms back, with a gentle acceleration curve. Tiny reversals do not create another animation. Reversing a transition captures its current transform. Focus and returning to the top reveal navigation. Height-only viewport changes do not cancel navigation or page travel; geometry is measured only when the actual controls or viewport width change.

## Rhythm

- Controls: 70ms press, 120ms release; scale 0.985 for buttons and 0.995 for cards. Dock buttons retain their size. Use one scale owner, never stack transform scaling with the scale property.
- Pages: browser-native smooth scrolling and snap, with duration managed by the browser. On engines supporting named scroll timelines and timeline scope, the selection pill uses a native scroll timeline and transform-only keyframes. Older engines fall back to cached geometry and scroll updates. Incoming pages stay opaque. New tab clicks reset document scroll before changing panel heights; tapping the current tab scrolls to the top.
- Dialogs: 220ms entry with 16px travel and scale 0.985; 160ms exit with 12px travel. The dimming layer animates its background independently of the content.
- Bottom sheets: 220ms entry, 160ms exit. Keep the sheet fully opaque. Dragging follows the pointer immediately; cancellation returns over 200ms. Dismiss beyond 64px, or beyond 24px with downward velocity above 0.45px/ms.
- Animation interruptions retain the current position, including closing during entry and regrabbing a rebound. The dimming layer also exits from its current color.
- Reduced motion removes CSS travel durations and press scaling. Completion and background unlocking still follow animation promises.

## Ownership and validation

The top toolbar shares a single surface with muted sage controls; input text stays at 16px to avoid iOS focus zoom. Camera and settings targets remain 44px across 320/390/430px layouts and light/dark/AMOLED themes.

CSS motion tokens live in `theme-overrides.css`. Header and horizontal page movement live in `index.html`. Modal drag, interruption and completion live in `sheet-gestures.js`. Build copies these sources into `www`; edit source files rather than generated copies.

Run `node --test tests/navigation_settle.test.mjs tests/gesture_smoothness.test.mjs tests/modal_gestures.test.mjs` and `node tests/pending-browser.cjs`. These cover actual scroll movement, empty-page gestures, reversal, dock hide/reveal endpoints, rapid tab switching, solid overlay surfaces, closing during entry, drag cancellation, content scrolling and background locking.

Browser checks use Edge mobile emulation. iOS WebKit, safe-area changes and device refresh-rate behavior still require physical-device verification.

## ProMotion constraints

No web setting can guarantee a fixed maximum physical refresh rate on iPhone Safari or home-screen web apps. The page uses compositor transforms and native scrolling rather than JavaScript frame-count assumptions. Where supported, the indicator uses threaded scroll animations. Low-power mode and iOS/browser policy can still limit the achieved rate. Frame timing from requestAnimationFrame would measure JavaScript callbacks, not prove the compositor or display runs at 120Hz.

References: https://webkit.org/blog/17862/webkit-features-for-safari-26-4/ and https://webkit.github.io/explainers/animation-frame-rate/
