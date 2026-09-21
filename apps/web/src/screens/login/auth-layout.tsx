import type { ReactNode } from 'react';
import { ScanIcon } from '../../components/ui/icons';
import { VersionBadge } from '../../components/shell/version-badge';

/** Écrans sans session : formulaire poussé vers le bas, à portée du pouce. */
export function AuthLayout({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div className="safe-top safe-bottom mx-auto flex min-h-dvh w-full max-w-md flex-col px-5">
      <div className="flex flex-1 flex-col justify-end gap-2 pb-8 pt-12">
        <div className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-accent-deep text-accent">
          <ScanIcon size={30} />
        </div>
        <h1 className="text-[28px] font-semibold leading-tight">{title}</h1>
        <p className="max-w-[36ch] text-[15px] text-muted">{lead}</p>
      </div>
      <div className="pb-10">{children}</div>
      <VersionBadge className="pt-0" />
    </div>
  );
}
