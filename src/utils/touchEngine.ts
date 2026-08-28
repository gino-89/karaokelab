/**
 * Universal 1-Tap Touch Engine for iPadOS, iOS Safari, Android & Touch Devices.
 *
 * Problem on iPadOS / Safari:
 * 1. WebKit emulates desktop mouse hover (:hover) on the 1st tap, requiring a 2nd tap to click.
 * 2. Frequent React re-renders during audio playback reset hover state, making taps drop or require 3+ taps.
 *
 * Solution:
 * On genuine single-finger taps, calling e.preventDefault() on `touchend` cancels WebKit's
 * delayed hover simulation and delayed ghost click, and immediately dispatches a direct
 * `.click()` to React's event root at 0ms latency.
 */

export function initUniversalTouchEngine(): () => void {
  if (typeof window === 'undefined') return () => {};

  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let isScrolling = false;
  let activeTouchTarget: HTMLElement | null = null;

  const isNativelyHandled = (el: HTMLElement | null): boolean => {
    if (!el) return false;
    const tag = el.tagName;
    // Native inputs that manage their own text focus or range sliding
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = (el as HTMLInputElement).type;
      if (['text', 'search', 'email', 'password', 'number', 'tel', 'url', 'range', 'file'].includes(type)) {
        return true;
      }
    }
    return false;
  };

  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = Date.now();
    isScrolling = false;

    let target = e.target as HTMLElement | null;
    if (target && target.nodeType === 3) {
      target = target.parentElement;
    }
    activeTouchTarget = target;
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (isScrolling || e.touches.length !== 1) return;

    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - startX);
    const dy = Math.abs(touch.clientY - startY);

    // If moved more than 10px, it's a scroll or gesture — not a tap
    if (dx > 10 || dy > 10) {
      isScrolling = true;
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    // If the user scrolled, pinched, or held for > 500ms, ignore
    if (isScrolling || e.changedTouches.length === 0) return;
    const duration = Date.now() - startTime;
    if (duration > 500) return;

    const touch = e.changedTouches[0];
    const dx = Math.abs(touch.clientX - startX);
    const dy = Math.abs(touch.clientY - startY);
    if (dx > 12 || dy > 12) return;

    let target = (activeTouchTarget || e.target || document.elementFromPoint(touch.clientX, touch.clientY)) as HTMLElement | null;
    if (target && target.nodeType === 3) {
      target = target.parentElement;
    }

    if (!target || isNativelyHandled(target)) return;

    // Check if target or any parent is disabled
    const buttonOrControl = target.closest('button, [role="button"], a, input, select') as HTMLElement | null;
    if (buttonOrControl && (buttonOrControl.hasAttribute('disabled') || (buttonOrControl as any).disabled)) {
      return;
    }

    // Cancel WebKit's 300ms delay & hover simulation
    if (e.cancelable) {
      try {
        e.preventDefault();
      } catch (_) {}
    }

    // Fire the click immediately to React
    if (typeof target.click === 'function') {
      target.click();
    } else {
      const clickableParent = target.closest('button, a, [role="button"], label, div') as HTMLElement | null;
      if (clickableParent && typeof clickableParent.click === 'function') {
        clickableParent.click();
      } else {
        target.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: 1,
          clientX: touch.clientX,
          clientY: touch.clientY,
        }));
      }
    }
  };

  const options: AddEventListenerOptions = { passive: false, capture: true };

  window.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
  window.addEventListener('touchmove', handleTouchMove, { passive: true, capture: true });
  window.addEventListener('touchend', handleTouchEnd, options);

  return () => {
    window.removeEventListener('touchstart', handleTouchStart, { capture: true });
    window.removeEventListener('touchmove', handleTouchMove, { capture: true });
    window.removeEventListener('touchend', handleTouchEnd, { capture: true } as any);
  };
}
