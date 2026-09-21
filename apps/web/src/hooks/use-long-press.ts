import { useCallback, useRef, type PointerEvent } from 'react';

interface LongPressOptions {
  onLongPress: () => void;
  onClick?: () => void;
  delayMs?: number;
}

/**
 * Appui long (500 ms) sans déclencher le clic : sert à « tout consommer » (parcours P3).
 * Le clic normal reste disponible pour l'action rapide.
 */
export function useLongPress({ onLongPress, onClick, delayMs = 500 }: LongPressOptions) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      fired.current = false;
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        if ('vibrate' in navigator) navigator.vibrate?.(30);
        onLongPress();
      }, delayMs);
    },
    [clear, delayMs, onLongPress],
  );

  const onPointerUp = useCallback(() => {
    const wasPending = timer.current !== null;
    clear();
    if (wasPending && !fired.current) onClick?.();
  }, [clear, onClick]);

  const onPointerCancel = useCallback(() => {
    clear();
  }, [clear]);

  return {
    onPointerDown,
    onPointerUp,
    onPointerLeave: onPointerCancel,
    onPointerCancel,
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
  };
}
