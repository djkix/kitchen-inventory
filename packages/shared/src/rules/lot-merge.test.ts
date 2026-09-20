import { describe, expect, it } from 'vitest';
import { findMergeableLot, sameExpiry } from './lot-merge.js';

const d = (iso: string) => new Date(`${iso}T12:00:00`);

describe('sameExpiry', () => {
  it('deux dates nulles sont identiques', () => {
    expect(sameExpiry(null, null)).toBe(true);
  });
  it('une seule date nulle n’est pas identique', () => {
    expect(sameExpiry(d('2026-10-01'), null)).toBe(false);
  });
  it('compare au jour civil', () => {
    expect(sameExpiry(new Date('2026-10-01T02:00:00'), new Date('2026-10-01T22:00:00'))).toBe(true);
    expect(sameExpiry(d('2026-10-01'), d('2026-10-02'))).toBe(false);
  });
});

describe('findMergeableLot', () => {
  const lots = [
    { id: 'l1', productId: 'p1', locationId: 'loc1', expiryDate: d('2026-10-01'), unit: 'PIECE', archivedAt: null },
    { id: 'l2', productId: 'p1', locationId: 'loc1', expiryDate: null, unit: 'PIECE', archivedAt: null },
    { id: 'l3', productId: 'p1', locationId: 'loc1', expiryDate: d('2026-11-01'), unit: 'PIECE', archivedAt: d('2026-09-01') },
  ];
  it('trouve le lot de même produit, emplacement, unité et date', () => {
    expect(findMergeableLot(lots, { productId: 'p1', locationId: 'loc1', expiryDate: d('2026-10-01'), unit: 'PIECE' })?.id).toBe('l1');
    expect(findMergeableLot(lots, { productId: 'p1', locationId: 'loc1', expiryDate: null, unit: 'PIECE' })?.id).toBe('l2');
  });
  it('ne fusionne pas sur une date différente', () => {
    expect(findMergeableLot(lots, { productId: 'p1', locationId: 'loc1', expiryDate: d('2026-10-02'), unit: 'PIECE' })).toBeNull();
  });
  it('ignore les lots archivés, les autres emplacements et les autres unités', () => {
    expect(findMergeableLot(lots, { productId: 'p1', locationId: 'loc1', expiryDate: d('2026-11-01'), unit: 'PIECE' })).toBeNull();
    expect(findMergeableLot(lots, { productId: 'p1', locationId: 'loc2', expiryDate: d('2026-10-01'), unit: 'PIECE' })).toBeNull();
    expect(findMergeableLot(lots, { productId: 'p1', locationId: 'loc1', expiryDate: d('2026-10-01'), unit: 'PACK' })).toBeNull();
  });
});
