import type { LocationNode, StockItemDto } from '@kitchen/shared';
import { useState } from 'react';
import { LocationList } from '../../components/forms/location-list';
import { Button } from '../../components/ui/button';
import { Sheet } from '../../components/ui/sheet';
import { ListSkeleton } from '../../components/ui/skeleton';
import { useLocationsQuery } from '../../lib/queries';

interface MoveSheetProps {
  item: StockItemDto;
  open: boolean;
  onClose: () => void;
  onConfirm: (location: LocationNode) => Promise<void>;
}

export function MoveSheet({ item, open, onClose, onConfirm }: MoveSheetProps) {
  const locations = useLocationsQuery();
  const [selected, setSelected] = useState<LocationNode | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await onConfirm(selected);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} locked={busy} title="Déplacer" description={`Actuellement : ${item.location.path.replace(/\//g, ' › ')}`}>
      {locations.isPending ? (
        <ListSkeleton rows={4} />
      ) : (
        <LocationList tree={locations.data ?? []} selectedId={selected?.id ?? null} onSelect={setSelected} disabledIds={[item.locationId]} />
      )}
      <div className="pt-4">
        <Button variant="primary" size="lg" block disabled={!selected} loading={busy} onClick={() => void confirm()}>
          {selected ? `Déplacer vers ${selected.name}` : 'Choisissez un emplacement'}
        </Button>
      </div>
    </Sheet>
  );
}
