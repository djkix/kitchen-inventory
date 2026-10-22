import type { AttachLabelInput, PendingLabelDto, ReceiptDto, ValidateReceiptInput } from '@kitchen/shared';
import { api } from './api';

export const receiptsApi = {
  /** Lecture d'un ticket (EF-29) : coûte un appel au modèle et du quota, d'où un envoi par geste. */
  read(file: File, locationId: string): Promise<ReceiptDto> {
    const form = new FormData();
    form.append('locationId', locationId);
    form.append('file', file, file.name || 'ticket');
    return api.postForm<ReceiptDto>('/receipts', form);
  },
  validate(id: string, input: ValidateReceiptInput): Promise<{ added: number }> {
    return api.post<{ added: number }>(`/receipts/${encodeURIComponent(id)}/validate`, input);
  },
  pendingLabels(): Promise<PendingLabelDto[]> {
    return api.get<PendingLabelDto[]>('/receipts/pending-labels');
  },
  /** Nombre de libellés **distincts** : ce n'est pas le `count` d'une entrée de la liste (lignes). */
  pendingLabelCount(): Promise<{ count: number }> {
    return api.get<{ count: number }>('/receipts/pending-labels/count');
  },
  attachLabel(input: AttachLabelInput): Promise<void> {
    return api.post<void>('/receipts/pending-labels/attach', input);
  },
};
