import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface BarcodeScannerProps {
  attachVideo: (element: HTMLVideoElement | null) => void;
  /** Vrai pendant qu'une lecture est en cours de traitement : le réticule s'allume. */
  busy?: boolean;
  paused?: boolean;
  children?: ReactNode;
}

/** Caméra plein écran avec réticule ; les bandeaux sont passés en enfants. */
export function BarcodeScanner({ attachVideo, busy = false, paused = false, children }: BarcodeScannerProps) {
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <video ref={attachVideo} autoPlay muted playsInline className={cn('absolute inset-0 size-full object-cover transition-opacity', paused && 'opacity-40')} />
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className={cn('relative h-[34vw] w-[78vw] max-w-[380px] max-h-[170px] transition-colors', busy ? 'text-accent' : 'text-white/85')}>
          <Corner className="left-0 top-0 rotate-0" />
          <Corner className="right-0 top-0 rotate-90" />
          <Corner className="bottom-0 right-0 rotate-180" />
          <Corner className="bottom-0 left-0 -rotate-90" />
          {!paused && <div className={cn('absolute inset-x-3 top-1/2 h-px bg-current', busy ? 'opacity-100' : 'anim-pulse')} />}
        </div>
      </div>
      {children}
    </div>
  );
}

function Corner({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" className={cn('absolute', className)} aria-hidden>
      <path d="M2 12V4a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
