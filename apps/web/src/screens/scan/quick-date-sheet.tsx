import { isoDateSchema } from '@kitchen/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input, Select } from '../../components/ui/input';
import { Sheet } from '../../components/ui/sheet';
import { errorMessage } from '../../lib/api';
import { DATE_TYPE_OPTIONS } from '../item/date-sheet';
import type { LastAdded } from './last-added-banner';

interface QuickDateSheetProps {
  entry: LastAdded | null;
  onClose: () => void;
  onConfirm: (entry: LastAdded, expiryDate: string, dateType: 'USE_BY' | 'BEST_BEFORE') => Promise<void>;
}

/** Parcours P2 : saisie de la DLC juste après l'ajout, sans quitter la caméra. */
export function QuickDateSheet({ entry, onClose, onConfirm }: QuickDateSheetProps) {
  const [date, setDate] = useState('');
  const [type, setType] = useState<'USE_BY' | 'BEST_BEFORE'>('USE_BY');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!entry) return null;

  const submit = async () => {
    const parsed = isoDateSchema.safeParse(date);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Date invalide');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(entry, parsed.data, type);
      setDate('');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} locked={busy} title="Date de péremption" description={entry.name}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input label="Date" type="date" autoFocus value={date} onChange={(event) => setDate(event.target.value)} error={error ?? undefined} />
        <Select label="Type" options={DATE_TYPE_OPTIONS} value={type} onChange={(event) => setType(event.target.value as 'USE_BY' | 'BEST_BEFORE')} />
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Enregistrer la date
        </Button>
      </form>
    </Sheet>
  );
}
