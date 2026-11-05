import { useTheme } from '../../hooks/use-theme';
import { cn } from '../../lib/cn';
import type { ThemeChoice } from '../../lib/theme';

const CHOICES: Array<{ value: ThemeChoice; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
];

/**
 * Choix du thème (2026-10-23). Réglage d'appareil, gardé dans le navigateur :
 * le téléphone du cellier et le portable du bureau n'ont pas à partager leur
 * luminosité, et aucun compte n'a à le connaître.
 */
export function ThemeRow() {
  const theme = useTheme();

  return (
    <div className="flex min-h-[56px] items-center gap-3 rounded-card bg-surface px-4 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-medium">Apparence</span>
        <span className="text-[13px] text-muted">
          {theme.choice === 'auto'
            ? `Suit le réglage du téléphone — actuellement ${theme.resolved === 'light' ? 'clair' : 'sombre'}`
            : 'Imposée, quel que soit le réglage du téléphone'}
        </span>
      </div>
      <div role="radiogroup" aria-label="Apparence" className="flex shrink-0 gap-1 rounded-xl bg-raised p-1">
        {CHOICES.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={theme.choice === item.value}
            onClick={() => theme.set(item.value)}
            className={cn(
              'min-h-[34px] rounded-lg px-3 text-[13px] font-medium',
              theme.choice === item.value ? 'bg-accent text-ink' : 'text-muted active:bg-surface',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
