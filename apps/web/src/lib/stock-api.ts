import type { CreateStockItemInput, StockItemDto, StockWriteResult, UpdateStockItemInput } from '@kitchen/shared';
import { api, newClientOpId } from './api';

/**
 * Écritures de stock. Chaque écriture porte un `clientOpId` : un nouvel essai
 * après coupure réseau ne double jamais un mouvement.
 */
export const stockApi = {
  create(input: Omit<CreateStockItemInput, 'clientOpId'>): Promise<StockWriteResult> {
    return api.post<StockWriteResult>('/stock', { ...input, clientOpId: newClientOpId() });
  },
  consume(id: string, quantity: number, reason?: string): Promise<StockWriteResult> {
    return api.post<StockWriteResult>(`/stock/${id}/consume`, { quantity, reason, clientOpId: newClientOpId() });
  },
  /** Delta signé ; sert à l'annulation (delta inverse) et aux corrections. */
  adjust(id: string, delta: number, reason?: string): Promise<StockWriteResult> {
    return api.post<StockWriteResult>(`/stock/${id}/adjust`, { delta, reason, clientOpId: newClientOpId() });
  },
  open(id: string): Promise<StockItemDto> {
    return api.post<StockItemDto>(`/stock/${id}/open`);
  },
  move(id: string, locationId: string): Promise<StockItemDto> {
    return api.post<StockItemDto>(`/stock/${id}/move`, { locationId });
  },
  update(id: string, input: UpdateStockItemInput): Promise<StockItemDto> {
    return api.patch<StockItemDto>(`/stock/${id}`, input);
  },
  discard(id: string, reason?: string): Promise<StockWriteResult> {
    return api.delete<StockWriteResult>(`/stock/${id}`, reason ? { reason } : undefined);
  },
};
