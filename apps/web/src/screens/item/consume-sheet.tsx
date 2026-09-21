import type { StockItemDto } from '@kitchen/shared';
import { roundQuantity, UNIT_LABELS_FR } from '@kitchen/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Sheet } from '../../components/ui/sheet';
import { consumeStep, formatQuantity } from '../../lib/quantity-ui';

interface ConsumeSheetProps {
  item: StockItemDto | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (quantity: number) => Promise<void>;
}

/** Tiroir de consommation : pas rapides, saisie libre, « tout consommer ». */
export function ConsumeSheet({ item, open, onClose, onConfirm }: ConsumeSheetProps) {
  const [value, setValue] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!item) return null;
  const step = consumeStep(item.unit, item.quantity);
  const presets = [step, roundQuantity(step * 2), roundQuantity(step * 5)].filter((q, i, arr) => q > 0 && q < item.quantity && arr.indexOf(q) === i);
  const parsed = value === '' ? step : Number(value.replace(',', '.'));

  const confirm = async (quantity: number) => {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Indiquez une quantité positive.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onConfirm(roundQuantity(quantity));
      setValue('');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} locked={busy} title="Consommer" description={`${item.product.name} — ${formatQuantity(item.quantity, item.unit)} en stock`}>
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {presets.map((preset) => (
            <Button key={preset} variant="outline" className="flex-1 tnum" onClick={() => setValue(String(preset))} aria-pressed={parsed === preset}>
              {formatQuantity(preset, item.unit)}
            </Button>
          ))}
        </div>
        <Input
          label={`Quantité (${UNIT_LABELS_FR[item.unit]})`}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          value={value}
          placeholder={String(step)}
          onChange={(event) => setValue(event.target.value)}
          error={error ?? undefined}
          hint="Au-delà du stock disponible, la consommation est ramenée à la quantité restante."
        />
        <div className="flex flex-col gap-2 pt-1">
          <Button variant="primary" size="lg" block loading={busy} onClick={() => void confirm(parsed)}>
            Consommer {formatQuantity(Number.isFinite(parsed) && parsed > 0 ? parsed : step, item.unit)}
          </Button>
          <Button variant="danger" size="lg" block disabled={busy} onClick={() => void confirm(item.quantity)}>
            Tout consommer
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
