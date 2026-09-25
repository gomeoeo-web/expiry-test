// Shared modal gestures. Coordinates stay in this closure; only the card moves.
(function () {
'use strict';
const controllers = new WeakMap();
const interactive = 'button, [role="button"], a, input, select, textarea, label, [contenteditable="true"], .history-header-toggle, .cat-drag-handle';
const headers = '.sheet-drag-handle, .sheet-header, .ios-modal-header';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function bindSheetDrag(modal, onDismiss, scrollArea) {
  const card = modal?.querySelector('.ios-modal-card, .ios-action-sheet');
  if (!card || controllers.has(modal)) return;
  const scroller = scrollArea || card;
  let gesture = null;
  let motion = null;
  let suppressClick = false;

  function freeze() {
    const transform = getComputedStyle(card).transform;
    card.classList.add('sheet-gesture-controlled');
    card.style.transition = 'none';
    card.style.transform = transform === 'none' ? 'translateY(0px)' : transform;
    motion?.cancel();
    motion = null;
    return card.style.transform;
  }

  function releasePointer() {
    const previous = gesture;
    gesture = null;
    if (previous?.kind === 'pointer' && card.hasPointerCapture(previous.id)) {
      card.releasePointerCapture(previous.id);
    }
  }

  function reset() {
    releasePointer();
    motion?.cancel();
    motion = null;
    card.classList.remove('sheet-gesture-controlled');
    card.style.transform = '';
    card.style.transition = '';
  }

  function rebound() {
    const from = freeze();
    card.style.transform = 'translateY(0px)';
    const animation = card.animate([{ transform: from }, { transform: 'translateY(0px)' }], {
      duration: reducedMotion() ? 0 : 200,
      easing: 'cubic-bezier(0.32, 0.72, 0, 1)'
    });
    motion = animation;
    animation.finished.then(() => {
      if (motion === animation) {
        motion = null;
        // Keep the opening CSS animation disabled until hidden, so it cannot replay.
        card.style.transform = 'translateY(0px)';
      }
    }).catch(() => {});
  }

  function start(point, event, kind) {
    suppressClick = false;
    if (modal.classList.contains('modal-closing') || event.target.closest(interactive)) return;
    const fromBackdrop = event.target === modal;
    if (!fromBackdrop && !card.contains(event.target)) return;
    const offset = motion ? new DOMMatrixReadOnly(freeze()).m42 : 0;
    gesture = {
      kind, id: kind === 'touch' ? point.identifier : event.pointerId,
      startX: point.clientX, startY: point.clientY, offset,
      eligible: fromBackdrop || !!event.target.closest(headers) || scroller.scrollTop <= 0,
      mode: 'pending', dy: offset, lastY: point.clientY, lastTime: event.timeStamp,
      velocity: 0
    };
  }

  function move(point, event) {
    if (!gesture || modal.classList.contains('modal-closing')) return;
    const dx = point.clientX - gesture.startX;
    const dy = point.clientY - gesture.startY;
    if (gesture.mode === 'pending') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
      gesture.mode = gesture.eligible && dy > Math.abs(dx) ? 'drag' : 'scroll';
      if (gesture.mode === 'drag') {
        freeze();
        suppressClick = true;
        if (gesture.kind === 'pointer') card.setPointerCapture(gesture.id);
      }
    }
    if (gesture.mode !== 'drag') return;
    if (event.cancelable) event.preventDefault();
    const elapsed = event.timeStamp - gesture.lastTime;
    if (elapsed > 0) gesture.velocity = (point.clientY - gesture.lastY) / elapsed;
    gesture.lastTime = event.timeStamp;
    gesture.lastY = point.clientY;
    // Always update after claiming the gesture, including a reversal back to zero.
    gesture.dy = Math.max(0, gesture.offset + dy);
    card.style.transform = `translateY(${gesture.dy}px)`;
  }

  function end(event, cancelled = false) {
    if (!gesture) return;
    const ended = gesture;
    releasePointer();
    if (ended.mode !== 'drag') {
      if (ended.offset) rebound();
      return;
    }
    const velocity = event.timeStamp - ended.lastTime <= 100 ? ended.velocity : 0;
    if (!cancelled && (ended.dy > 35 || (ended.dy > 15 && velocity > 0.22))) {
      onDismiss();
      // A form can reject dismissal (for example an invalid date).
      if (!modal.classList.contains('modal-closing') && modal.style.display !== 'none') rebound();
    } else {
      rebound();
    }
  }

  modal.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { end(event, true); return; }
    if (!gesture) start(event.touches[0], event, 'touch');
  }, { passive: true });
  modal.addEventListener('touchmove', event => {
    if (gesture?.kind !== 'touch') return;
    if (event.touches.length !== 1) { end(event, true); return; }
    const point = Array.from(event.touches).find(touch => touch.identifier === gesture.id);
    if (point) move(point, event);
  }, { passive: false });
  modal.addEventListener('touchend', event => {
    if (gesture?.kind !== 'touch') return;
    const point = Array.from(event.changedTouches).find(touch => touch.identifier === gesture.id);
    if (point) { if (gesture.mode === 'drag' && point.clientY !== gesture.lastY) move(point, event); end(event); }
  }, { passive: false });
  modal.addEventListener('touchcancel', event => end(event, true), { passive: true });

  // Touch has one owner above; pointer events add mouse/pen support without double handling it.
  modal.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' && event.isPrimary && event.button === 0 && !gesture) start(event, event, 'pointer');
  });
  window.addEventListener('pointermove', event => {
    if (gesture?.kind === 'pointer' && gesture.id === event.pointerId) move(event, event);
  }, { passive: false });
  window.addEventListener('pointerup', event => {
    if (gesture?.kind === 'pointer' && gesture.id === event.pointerId) {
      if (event.clientY !== gesture.lastY) move(event, event);
      end(event);
    }
  });
  card.addEventListener('lostpointercapture', event => {
    if (gesture?.kind === 'pointer' && gesture.id === event.pointerId) end(event, true);
  });
  window.addEventListener('pointercancel', event => {
    if (gesture?.kind === 'pointer' && gesture.id === event.pointerId) end(event, true);
  });
  window.addEventListener('blur', event => end(event, true));
  modal.addEventListener('click', event => {
    if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
  }, true);

  controllers.set(modal, {
    reset,
    prepareClose() {
      releasePointer();
      return card.classList.contains('sheet-gesture-controlled') ? freeze() : null;
    }
  });
  new MutationObserver(() => { if (modal.style.display === 'none') reset(); })
    .observe(modal, { attributes: true, attributeFilter: ['style'] });
}

function animateModalClose(modal, onClosed) {
  if (!modal || modal.style.display === 'none') { onClosed?.(); return; }
  if (modal.classList.contains('modal-closing')) return;
  const card = modal.querySelector('.ios-modal-card, .ios-action-sheet');
  const controller = controllers.get(modal);
  const from = controller?.prepareClose();
  const currentY = from ? new DOMMatrixReadOnly(from).m42 : 0;
  const exitY = from ? Math.max(card.offsetHeight, window.innerHeight - card.getBoundingClientRect().top + currentY) + 24 : 0;
  modal.classList.add('modal-closing');
  let animations;
  if (from) {
    // Continue from the finger position, instead of restarting CSS keyframes at zero.
    animations = [card.animate([
      { transform: from }, { transform: `translateY(${exitY}px)` }
    ], {
      duration: reducedMotion() ? 0 : (parseFloat(getComputedStyle(card).getPropertyValue('--motion-duration')) || 280),
      easing: getComputedStyle(card).getPropertyValue('--motion-ease').trim() || 'cubic-bezier(.22,.72,.18,1)',
      fill: 'forwards'
    })];
  } else {
    animations = card ? card.getAnimations() : [];
  }
  animations.push(...modal.getAnimations());
  // Completion follows the browser's animation timeline at any refresh rate.
  Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(() => {
    modal.style.display = 'none';
    animations.forEach(animation => animation.cancel());
    controller?.reset();
    modal.classList.remove('modal-closing');
    onClosed?.();
  });
}

function containModalScroll(backdrop) {
  let lastY = null;
  backdrop.addEventListener('touchstart', event => {
    lastY = event.touches.length === 1 ? event.touches[0].clientY : null;
  }, { passive: true });
  backdrop.addEventListener('touchmove', event => {
    if (lastY === null || event.touches.length !== 1 || event.defaultPrevented) return;
    const y = event.touches[0].clientY;
    const dy = y - lastY;
    lastY = y;
    if (!backdrop.classList.contains('modal-closing')) {
      if (event.target.closest('input[type="range"]')) return;
      // Allow the nearest scroll area that has room in the requested direction.
      for (let el = event.target; el && el !== backdrop; el = el.parentElement) {
        if (el.scrollHeight <= el.clientHeight || !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
        if ((dy > 0 && el.scrollTop > 0) || (dy < 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return;
      }
    }
    if (event.cancelable) event.preventDefault();
  }, { passive: false });
}

window.SheetGestures = { bindSheetDrag, animateModalClose, containModalScroll };
})();
