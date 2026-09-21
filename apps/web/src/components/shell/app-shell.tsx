import type { ReactNode } from 'react';
import { Link, Outlet } from 'react-router';
import { cn } from '../../lib/cn';
import { IconButton } from '../ui/button';
import { BackIcon } from '../ui/icons';
import { BottomNav } from './bottom-nav';
import { VersionBadge } from './version-badge';

/** Coque des quatre onglets : contenu défilant, barre de navigation fixe en bas. */
export function AppShell() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <main className="flex-1 pb-[calc(var(--spacing-nav)+env(safe-area-inset-bottom,0px)+16px)]">
        <Outlet />
        <VersionBadge />
      </main>
      <BottomNav />
    </div>
  );
}

interface ScreenHeaderProps {
  title: string;
  /** Lien de retour ; absent sur les onglets de premier niveau. */
  back?: string;
  actions?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}

export function ScreenHeader({ title, back, actions, subtitle, className }: ScreenHeaderProps) {
  return (
    <header className={cn('safe-top sticky top-0 z-20 bg-ink/95 backdrop-blur', className)}>
      <div className="flex min-h-[56px] items-center gap-1 px-2">
        {back && (
          <Link to={back} aria-label="Retour" className="inline-flex size-touch items-center justify-center rounded-xl text-fg active:bg-raised">
            <BackIcon />
          </Link>
        )}
        <div className={cn('flex-1 py-2', back ? '' : 'pl-2')}>
          <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
          {subtitle && <div className="text-[13px] text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-1 pr-1">{actions}</div>}
      </div>
    </header>
  );
}

export { IconButton };
