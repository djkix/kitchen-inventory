import type { DateType, ProductDto } from '@kitchen/shared';
import { UNIT_LABELS_FR, expiryShortcutDate, roundQuantity } from '@kitchen/shared';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '../../components/ui/button';
import { Sheet } from '../../components/ui/sheet';
import { Input, Select } from '../../components/ui/input';
import { CheckIcon, CloseIcon, MinusIcon, PlusIcon } from '../../components/ui/icons';
import { cn } from '../../lib/cn';
import { mediaUrl } from '../../lib/api';
import { formatQuantity, unitStep } from '../../lib/quantity-ui';

export interface ConfirmTarget {
  product: ProductDto;
  /** `cache` : produit déjà connu du foyer. `off` : fiche créée depuis Open Food Facts. */
  source: 'cache' | 'off';
  barcode: string;
}

/** Date choisie dans le tiroir de validation : rien n'est envoyé si elle reste absente. */
export interface ConfirmDate {
  expiryDate: string;
  dateType: DateType;
}

interface ConfirmSheetProps {
  target: ConfirmTarget | null;
  locationName: string;
  busy: boolean;
  onConfirm: (quantity: number, date: ConfirmDate | null) => void;
  onCancel: () => void;
}

const SHORTCUTS: Array<{ kind: Parameters<typeof expiryShortcutDate>[0]; label: string }> = [
  { kind: 'threeDays', label: '+3 j' },
  { kind: 'oneWeek', label: '+1 sem' },
  { kind: 'oneMonth', label: '+1 mois' },
];

/**
 * Libellés courts, propres au tiroir de validation : le contrôle y est trop
 * étroit (environ 160 px sur un téléphone) pour la formulation complète de
 * `DATE_TYPE_OPTIONS` (`date-sheet.tsx`), qui a sa place là où l'espace ne
 * manque pas.
 */
const SHORT_DATE_TYPE_OPTIONS: Array<{ value: DateType; label: string }> = [
  { value: 'USE_BY', label: 'DLC' },
  { value: 'BEST_BEFORE', label: 'DDM' },
];

function shortDateTypeLabel(type: DateType): string {
  return SHORT_DATE_TYPE_OPTIONS.find((option) => option.value === type)!.label;
}

const DATE_SENTENCE_FORMAT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const DATE_SENTENCE_FORMAT_WITH_YEAR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * « DLC — périme le 12 octobre » / « DDM — à consommer de préférence avant
 * le 12 octobre 2027 » : type explicite (jamais sous-entendu par la seule
 * couleur ou position d'un bouton), année ajoutée seulement quand la date
 * sort de l'année en cours — un « +1 mois » tapé fin décembre glisse sur
 * janvier sans le dire autrement. Date civile « AAAA-MM-JJ », sans décalage
 * de fuseau.
 */
function dateSentence(date: ConfirmDate): string {
  const parsed = new Date(`${date.expiryDate}T00:00:00`);
  const format = parsed.getFullYear() === new Date().getFullYear() ? DATE_SENTENCE_FORMAT : DATE_SENTENCE_FORMAT_WITH_YEAR;
  const formatted = format.format(parsed);
  const action = date.dateType === 'USE_BY' ? `périme le ${formatted}` : `à consommer de préférence avant le ${formatted}`;
  return `${shortDateTypeLabel(date.dateType)} — ${action}`;
}

/**
 * Validation explicite après lecture d'un code-barres : le produit reconnu est
 * affiché, l'utilisateur ajuste la quantité puis confirme. Rien n'entre en
 * stock sans ce geste, ce qui évite les ajouts involontaires en rafale.
 */
export function ConfirmSheet({ target, locationName, busy, onConfirm, onCancel }: ConfirmSheetProps) {
  const initial = target ? unitStep(target.product.defaultUnit) : 1;
  const [quantity, setQuantity] = useState(initial);
  const [raw, setRaw] = useState('');
  const [date, setDate] = useState<ConfirmDate | null>(null);
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [draftType, setDraftType] = useState<DateType>('USE_BY');

  // Chaque nouveau produit repart du pas de son unité : une pièce, 100 g, 0,1 l.
  // La date, elle, repart toujours absente : rien n'est présélectionné.
  useEffect(() => {
    if (target) {
      setQuantity(unitStep(target.product.defaultUnit));
      setRaw('');
      setDate(null);
      setCustomDateOpen(false);
      setDraftType('USE_BY');
    }
  }, [target]);

  if (!target) return null;
  const { product } = target;
  const unit = product.defaultUnit;
  const step = unitStep(unit);
  const image = mediaUrl(product.imagePath);
  const valid = Number.isFinite(quantity) && quantity > 0;

  const bump = (delta: number) => {
    const next = roundQuantity(Math.max(step, quantity + delta));
    setQuantity(next);
    setRaw('');
  };

  const onTyped = (value: string) => {
    setRaw(value);
    const parsed = Number(value.replace(',', '.'));
    setQuantity(Number.isFinite(parsed) ? roundQuantity(parsed) : Number.NaN);
  };

  const applyShortcut = (kind: (typeof SHORTCUTS)[number]['kind']) => {
    setDate({ expiryDate: expiryShortcutDate(kind, new Date()), dateType: 'USE_BY' });
    setCustomDateOpen(false);
  };

  const onCustomDatePicked = (value: string) => {
    if (!value) return;
    setDate({ expiryDate: value, dateType: draftType });
    setCustomDateOpen(false);
  };

  const onDraftTypeChanged = (next: DateType) => {
    setDraftType(next);
    // Le type peut aussi être corrigé après coup, sans ressaisir la date.
    setDate((current) => (current ? { ...current, dateType: next } : current));
  };

  const clearDate = () => {
    setDate(null);
    setCustomDateOpen(false);
  };

  return (
    <Sheet
      open
      onClose={onCancel}
      locked={busy}
      title="Ajouter cet article ?"
      description={`Sera rangé dans ${locationName}`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {image ? (
            <img src={image} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-raised text-[22px]" aria-hidden="true">
              {product.category?.icon ?? '🏷️'}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[17px] font-semibold leading-tight">{product.name}</p>
            {product.originalName && <p className="truncate text-[14px] text-muted">{product.originalName}</p>}
            <p className="truncate text-[13px] text-faint">
              {[product.brand, product.category?.name].filter(Boolean).join(' · ') || 'Sans marque'}
            </p>
          </div>
        </div>

        <p className="text-[12px] text-faint">
          {target.source === 'cache' ? 'Produit déjà connu' : 'Fiche reprise d’Open Food Facts'} · code {target.barcode}
        </p>

        <div>
          <p className="mb-2 text-[14px] font-medium">Quantité</p>
          <div className="flex items-center gap-3">
            <IconButton label="Diminuer la quantité" onClick={() => bump(-step)} disabled={busy || quantity <= step} className="bg-raised">
              <MinusIcon />
            </IconButton>
            <input
              aria-label={`Quantité en ${UNIT_LABELS_FR[unit]}`}
              // Champ texte et non « number » : le clavier décimal français
              // produit une virgule, qu'un champ numérique rejette en silence.
              type="text"
              inputMode="decimal"
              value={raw === '' ? String(quantity) : raw}
              onChange={(event) => onTyped(event.target.value)}
              disabled={busy}
              className="tnum min-h-touch w-full rounded-xl border border-line bg-surface px-3 text-center text-[18px] text-fg focus:border-accent focus:outline-none disabled:text-faint"
            />
            <IconButton label="Augmenter la quantité" onClick={() => bump(step)} disabled={busy} className="bg-raised">
              <PlusIcon />
            </IconButton>
            <span className="w-16 shrink-0 text-[15px] text-muted">{UNIT_LABELS_FR[unit]}</span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-[14px] font-medium">Date de péremption</p>
          {date ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-raised px-3.5 py-2">
              <div className="flex min-w-0 items-center gap-2">
                {/* Le type reste modifiable après le choix de la date : jamais
                    besoin de la retirer pour passer de DLC à DDM. */}
                <div role="group" aria-label="Type de date" className="flex shrink-0 overflow-hidden rounded-lg border border-line">
                  {SHORT_DATE_TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      disabled={busy}
                      aria-pressed={date.dateType === option.value}
                      onClick={() => onDraftTypeChanged(option.value)}
                      className={cn(
                        'min-h-touch min-w-touch px-2.5 text-[13px] font-semibold',
                        date.dateType === option.value ? 'bg-accent text-ink' : 'bg-transparent text-muted active:bg-line disabled:text-faint',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="truncate text-[14px] text-fg">{dateSentence(date)}</p>
              </div>
              <IconButton label="Retirer la date" onClick={clearDate} disabled={busy}>
                <CloseIcon size={16} />
              </IconButton>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                {SHORTCUTS.map((shortcut) => (
                  <button
                    key={shortcut.kind}
                    type="button"
                    disabled={busy}
                    onClick={() => applyShortcut(shortcut.kind)}
                    className="min-h-touch flex-1 rounded-xl border border-line text-[13px] text-fg active:bg-raised disabled:text-faint"
                  >
                    {shortcut.label}
                  </button>
                ))}
              </div>
              {customDateOpen ? (
                <div className="flex gap-2">
                  <Input
                    label="Date"
                    type="date"
                    autoFocus
                    disabled={busy}
                    className="flex-1"
                    onChange={(event) => onCustomDatePicked(event.target.value)}
                  />
                  <Select
                    label="Type"
                    options={SHORT_DATE_TYPE_OPTIONS}
                    value={draftType}
                    disabled={busy}
                    className="flex-1"
                    onChange={(event) => onDraftTypeChanged(event.target.value as DateType)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCustomDateOpen(true)}
                  // Même cible tactile que le reste du tiroir (`min-h-touch`,
                  // 44 px) : un lien bas de 18 px se raterait d'une main,
                  // devant un placard.
                  className="inline-flex min-h-touch items-center self-start text-[13px] text-accent underline disabled:text-faint"
                >
                  autre date
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
            Ignorer
          </Button>
          <Button
            variant="primary"
            className="flex-[2]"
            icon={<CheckIcon size={18} />}
            loading={busy}
            disabled={!valid}
            onClick={() => onConfirm(quantity, date)}
          >
            Ajouter {valid ? formatQuantity(quantity, unit) : ''}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
