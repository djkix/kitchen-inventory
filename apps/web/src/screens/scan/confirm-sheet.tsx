import type { ProductDto } from '@kitchen/shared';
import { UNIT_LABELS_FR, roundQuantity } from '@kitchen/shared';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '../../components/ui/button';
import { Sheet } from '../../components/ui/sheet';
import { CheckIcon, MinusIcon, PlusIcon } from '../../components/ui/icons';
import { mediaUrl } from '../../lib/api';
import { formatQuantity, unitStep } from '../../lib/quantity-ui';

export interface ConfirmTarget {
  product: ProductDto;
  /** `cache` : produit déjà connu du foyer. `off` : fiche créée depuis Open Food Facts. */
  source: 'cache' | 'off';
  barcode: string;
}

interface ConfirmSheetProps {
  target: ConfirmTarget | null;
  locationName: string;
  busy: boolean;
  onConfirm: (quantity: number) => void;
  onCancel: () => void;
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

  // Chaque nouveau produit repart du pas de son unité : une pièce, 100 g, 0,1 l.
  useEffect(() => {
    if (target) {
      setQuantity(unitStep(target.product.defaultUnit));
      setRaw('');
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
            onClick={() => onConfirm(quantity)}
          >
            Ajouter {valid ? formatQuantity(quantity, unit) : ''}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
