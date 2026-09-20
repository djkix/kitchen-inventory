/**
 * Rapprochement des produits sans code-barres (section 15) : nom normalisé
 * (sans accent, en minuscules) plus marque. Au-delà de 90 % de similarité,
 * l'application propose la fusion ; elle ne fusionne jamais d'office.
 */
export function normalizeProductName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(value: string): Map<string, number> {
  const padded = ` ${value} `;
  const result = new Map<string, number>();
  for (let i = 0; i < padded.length - 1; i++) {
    const gram = padded.slice(i, i + 2);
    result.set(gram, (result.get(gram) ?? 0) + 1);
  }
  return result;
}

/** Coefficient de Dice sur les bigrammes des noms normalisés, entre 0 et 1. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeProductName(a);
  const nb = normalizeProductName(b);
  if (na === nb) return na.length === 0 ? 0 : 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let common = 0;
  for (const [gram, count] of ga) common += Math.min(count, gb.get(gram) ?? 0);
  const total = [...ga.values()].reduce((s, n) => s + n, 0) + [...gb.values()].reduce((s, n) => s + n, 0);
  return total === 0 ? 0 : (2 * common) / total;
}

function brandKey(brand: string | null): string {
  return brand ? normalizeProductName(brand) : '';
}

export function findDuplicateCandidates<T extends { id: string; name: string; brand: string | null }>(
  candidate: { name: string; brand: string | null },
  products: T[],
  threshold = 0.9,
): Array<{ product: T; score: number }> {
  const candidateKey = `${normalizeProductName(candidate.name)}|${brandKey(candidate.brand)}`;
  return products
    .map((product) => ({
      product,
      score: nameSimilarity(candidateKey, `${normalizeProductName(product.name)}|${brandKey(product.brand)}`),
    }))
    .filter((entry) => entry.score >= threshold)
    .sort((x, y) => y.score - x.score);
}
