import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useToast } from '../components/ui/toast';
import { errorMessage } from '../lib/api';
import { queryKeys } from '../lib/queries';
import { stockApi } from '../lib/stock-api';

interface UndoableStockChange {
  /** Message du toast, par exemple « 1 pièce consommée ». */
  message: string;
  itemId: string;
  /** Delta appliqué par l'action ; l'annulation rejoue son inverse via `POST /stock/:id/adjust`. */
  appliedDelta: number;
}

/**
 * Section 14 : aucune action destructrice sans annulation pendant 5 secondes.
 * L'annulation ne restaure pas une quantité absolue : elle insère un mouvement
 * d'ajustement de delta inverse, avec un nouveau `clientOpId`.
 */
export function useUndo() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const invalidateStock = useCallback(() => queryClient.invalidateQueries({ queryKey: queryKeys.stockAll }), [queryClient]);

  const announce = useCallback(
    ({ message, itemId, appliedDelta }: UndoableStockChange) => {
      void invalidateStock();
      if (appliedDelta === 0) {
        toast.show({ message });
        return;
      }
      toast.show({
        message,
        durationMs: 5000,
        action: {
          label: 'Annuler',
          onClick: async () => {
            try {
              await stockApi.adjust(itemId, -appliedDelta, 'Annulation');
              await invalidateStock();
              toast.show({ message: 'Annulé', tone: 'success', durationMs: 2000 });
            } catch (error) {
              toast.show({ message: `Annulation impossible : ${errorMessage(error)}`, tone: 'danger' });
            }
          },
        },
      });
    },
    [toast, invalidateStock],
  );

  const fail = useCallback(
    (error: unknown, prefix?: string) => {
      toast.show({ message: prefix ? `${prefix} : ${errorMessage(error)}` : errorMessage(error), tone: 'danger' });
    },
    [toast],
  );

  return { announce, fail, invalidateStock };
}
