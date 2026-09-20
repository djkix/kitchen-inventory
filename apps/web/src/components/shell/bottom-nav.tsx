import { NavLink } from 'react-router';
import { cn } from '../../lib/cn';
import { CartIcon, RecipesIcon, SettingsIcon, StockIcon } from '../ui/icons';
import { ScanFab } from './scan-fab';

interface Tab {
  to: string;
  label: string;
  icon: typeof StockIcon;
  end: boolean;
}

/** Grille de cinq : Stock, Recettes, scan au centre, Courses, Réglages. */
const TABS: ReadonlyArray<Tab | null> = [
  { to: '/', label: 'Stock', icon: StockIcon, end: true },
  { to: '/recettes', label: 'Recettes', icon: RecipesIcon, end: false },
  null,
  { to: '/courses', label: 'Courses', icon: CartIcon, end: false },
  { to: '/reglages', label: 'Réglages', icon: SettingsIcon, end: false },
];

export function BottomNav() {
  return (
    <nav aria-label="Navigation principale" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
      <ul className="mx-auto grid h-nav max-w-lg grid-cols-5 items-end">
        {TABS.map((tab) =>
          tab === null ? (
            <li key="scan" className="flex items-end justify-center pb-2">
              <ScanFab />
            </li>
          ) : (
            <li key={tab.to} className="h-full">
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn('flex h-full flex-col items-center justify-center gap-1 pt-2 pb-2 text-[12px] font-medium', isActive ? 'text-accent' : 'text-muted active:text-fg')
                }
              >
                {({ isActive }) => (
                  <>
                    <tab.icon size={24} strokeWidth={isActive ? 2.2 : 1.8} />
                    <span>{tab.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
