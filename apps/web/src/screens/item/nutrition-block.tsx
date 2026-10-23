import type { ProductDto } from '@kitchen/shared';
import { NutriscoreBadge } from '../../components/ui/nutriscore-badge';
import { nutrientSentence } from '../../lib/nutrition-ui';

/**
 * Repères nutritionnels de la fiche article (EF-30) : la lettre Nutri-Score et
 * ce qui est élevé, en une ligne. Rien n'est calculé ici ; Open Food Facts est
 * la seule source, et il ne renseigne pas tout — l'épicerie peu référencée
 * revient souvent sans note, ce que le bloc dit plutôt que de disparaître.
 */
export function NutritionBlock({ product }: { product: ProductDto }) {
  const sentence = nutrientSentence(product.nutrientLevels);
  // Sans code-barres, Open Food Facts n'a jamais été interrogé : pas de bloc.
  if (!product.nutriscoreGrade && !sentence && !product.barcode) return null;

  return (
    <section aria-label="Repères nutritionnels" className="flex items-center gap-3 rounded-card bg-surface px-4 py-3">
      {product.nutriscoreGrade ? (
        <NutriscoreBadge grade={product.nutriscoreGrade} />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-[17px] text-faint" aria-hidden>
          —
        </span>
      )}
      <p className="min-w-0 text-[14px]">
        {product.nutriscoreGrade ? `Nutri-Score ${product.nutriscoreGrade.toUpperCase()}` : 'Nutri-Score non renseigné'}
        {sentence && <span className="text-muted"> · {sentence}</span>}
      </p>
    </section>
  );
}
