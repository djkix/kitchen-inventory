import { Link, useLocation } from 'react-router';
import { ScanIcon } from '../ui/icons';

/** Bouton scan flottant, centré dans la barre du bas, à portée du pouce (section 14). */
export function ScanFab() {
  const location = useLocation();
  return (
    <Link
      to="/scan"
      state={{ from: location.pathname }}
      aria-label="Scanner un article"
      className="flex size-[62px] -translate-y-5 items-center justify-center rounded-full bg-accent text-ink shadow-[0_8px_24px_rgba(143,211,198,0.35)] ring-4 ring-ink active:scale-95 transition-transform"
    >
      <ScanIcon size={30} strokeWidth={2.2} />
    </Link>
  );
}
