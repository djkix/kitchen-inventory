import type { LocationNode } from '@kitchen/shared';
import { Link } from 'react-router';
import { LocationList } from '../../components/forms/location-list';
import { Sheet } from '../../components/ui/sheet';
import { ListSkeleton } from '../../components/ui/skeleton';
import { useLocationsQuery } from '../../lib/queries';

interface LocationPickerProps {
  open: boolean;
  selectedId: string | null;
  onSelect: (location: LocationNode) => void;
  onClose: () => void;
  /** Sans emplacement choisi, le tiroir ne se ferme pas : le scan en a besoin. */
  required?: boolean;
}

/** EF-06 : choix de l'emplacement courant, une fois, avant la rafale. */
export function LocationPicker({ open, selectedId, onSelect, onClose, required = false }: LocationPickerProps) {
  const locations = useLocationsQuery();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      locked={required && !selectedId}
      title="Où rangez-vous ?"
      description="L’emplacement reste sélectionné pour tous les articles suivants, jusqu’à ce que vous le changiez."
    >
      {locations.isPending ? (
        <ListSkeleton rows={4} />
      ) : (
        <LocationList tree={locations.data ?? []} selectedId={selectedId} onSelect={onSelect} />
      )}
      <p className="pt-4 text-center text-[13px] text-faint">
        Il manque un placard ?{' '}
        <Link to="/reglages/emplacements" className="text-accent underline-offset-2 hover:underline">
          Gérer les emplacements
        </Link>
      </p>
    </Sheet>
  );
}
