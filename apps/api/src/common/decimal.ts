import { Prisma } from '@prisma/client';

/** Prisma renvoie des Decimal ; l'API parle en nombres à deux décimales. */
export function toNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : value.toNumber();
}

/** Date civile « AAAA-MM-JJ » en Date locale à midi, pour éviter les glissements de fuseau. */
export function parseCivilDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(`${value}T12:00:00`);
}

export function formatCivilDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
