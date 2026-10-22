import { NavLink } from 'react-router';
import { cn } from '../../lib/cn';
import { usePendingLabelCountQuery } from '../../lib/queries';
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

const tabButtonClassName = (isActive: boolean) =>
  cn('flex h-full flex-col items-center justify-center gap-1 pt-2 pb-2 text-[12px] font-medium', isActive ? 'text-accent' : 'text-muted active:text-fg');

export function BottomNav() {
  const pendingLabels = usePendingLabelCountQuery().data?.count ?? 0;
  return (
    <nav aria-label="Navigation principale" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
      <ul className="mx-auto grid h-nav max-w-lg grid-cols-5 items-end">
        {TABS.map((tab) => {
          if (tab === null) {
            return (
              <li key="scan" className="flex items-end justify-center pb-2">
                <ScanFab />
              </li>
            );
          }

          // L'onglet Recettes ouvre toujours Suggestions (A1) : `to="/recettes"`
          // sans `end` le garde actif quand on est passé sur « Mes recettes »
          // par la bascule, sans mémoriser aucun volet.
          return (
            <li key={tab.to} className="h-full">
              <NavLink to={tab.to} end={tab.end} className={({ isActive }) => tabButtonClassName(isActive)}>
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <tab.icon size={24} strokeWidth={isActive ? 2.2 : 1.8} />
                      {tab.to === '/courses' && pendingLabels > 0 && (
                        <span
                          aria-label={`${pendingLabels} libellé${pendingLabels > 1 ? 's' : ''} en attente`}
                          className="tnum absolute -right-3 -top-1 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-semibold leading-[18px] text-ink"
                        >
                          {pendingLabels}
                        </span>
                      )}
                    </span>
                    <span>{tab.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
