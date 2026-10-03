import type { CookRecipeInput, CookResult, RecipeDto, RecipeIngredientDto, Unit } from '@kitchen/shared';
import { roundQuantity } from '@kitchen/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Checkbox, Input, Select } from '../../components/ui/input';
import { Sheet } from '../../components/ui/sheet';
import { StarRating } from '../../components/ui/star-rating';
import { useToast } from '../../components/ui/toast';
import { errorMessage, newClientOpId } from '../../lib/api';
import { formatQuantity } from '../../lib/quantity-ui';
import { queryKeys } from '../../lib/queries';
import { recipesApi } from '../../lib/recipes-api';

/** Sous-ensemble d'un ingrédient de recette nécessaire à la cuisson (tâche 17) : jamais redéfini, juste restreint depuis le DTO partagé. */
export interface CookableIngredient {
  id: string;
  label: string;
  quantity: number | null;
  unit: Unit | null;
  state: RecipeIngredientDto['state'];
  substitutable: boolean;
  candidates: RecipeIngredientDto['candidates'];
}

export interface CookableRecipe {
  id: string;
  title: string;
  servings: number;
  ingredients: CookableIngredient[];
}

export interface CookConfirmPayload {
  servingsCooked: number;
  lines: { ingredientId: string; productId?: string }[];
  stars: number | null;
}

/** Hors inventaire : rien à décrémenter, donc aucune case à cocher (A17). */
function isDecrementable(ingredient: CookableIngredient): boolean {
  return ingredient.state !== 'untracked';
}

/**
 * Candidat qui périme le plus tôt (A15), date absente classée en dernier.
 * Le serveur trie déjà `candidates` ainsi ; ce tri local est une ceinture et
 * des bretelles délibérée, pour que la présélection reste correcte même si
 * l'ordre reçu changeait un jour sans que ce composant soit mis à jour.
 */
function soonestExpiring(candidates: CookableIngredient['candidates']): CookableIngredient['candidates'][number] | undefined {
  return [...candidates].sort((a, b) => {
    if (a.nearestExpiry === null) return b.nearestExpiry === null ? 0 : 1;
    if (b.nearestExpiry === null) return -1;
    return a.nearestExpiry.localeCompare(b.nearestExpiry);
  })[0];
}

/**
 * Ligne qui exige un choix de produit à la cuisson (A15) : toute ligne dont le
 * serveur a calculé des candidats, substituable ou visant directement une
 * catégorie — jamais seulement `substitutable`, qui laisserait une ligne
 * « catégorie » sans sélecteur ni `productId` envoyé (défaut 1).
 */
function needsProductSelection(ingredient: CookableIngredient): boolean {
  return ingredient.candidates.length > 0;
}

/** Présélection du produit retenu pour chaque ligne à choix de produit (A15). */
function defaultProductSelections(ingredients: CookableIngredient[]): Record<string, string> {
  const entries: [string, string][] = [];
  for (const ingredient of ingredients) {
    const candidate = soonestExpiring(ingredient.candidates);
    if (isDecrementable(ingredient) && needsProductSelection(ingredient) && candidate) entries.push([ingredient.id, candidate.productId]);
  }
  return Object.fromEntries(entries);
}

interface CookSheetViewProps {
  recipe: CookableRecipe;
  busy: boolean;
  onConfirm: (payload: CookConfirmPayload) => void;
  onCancel: () => void;
}

/**
 * Contenu du tiroir de cuisson (EF-18, EF-28), dans l'esprit de la validation
 * du scan (section 8) : portions réalisées, lignes à décrémenter cochées par
 * défaut, produit choisi pour les lignes substituables, note facultative.
 * N'envoie jamais de quantité mise à l'échelle (A14) : elle n'est affichée ici
 * que pour information, recalculée depuis la quantité de base de la recette.
 */
export function CookSheetView({ recipe, busy, onConfirm, onCancel }: CookSheetViewProps) {
  const [raw, setRaw] = useState('');
  const [servingsCooked, setServingsCooked] = useState(recipe.servings);
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(recipe.ingredients.filter(isDecrementable).map((ingredient) => [ingredient.id, true])),
  );
  const [selectedProduct, setSelectedProduct] = useState<Record<string, string>>(() => defaultProductSelections(recipe.ingredients));
  const [stars, setStars] = useState<number | null>(null);

  const onPortionsTyped = (value: string) => {
    setRaw(value);
    const parsed = Math.round(Number(value.replace(',', '.')));
    setServingsCooked(Number.isFinite(parsed) ? parsed : Number.NaN);
  };

  const validPortions = Number.isInteger(servingsCooked) && servingsCooked >= 1 && servingsCooked <= 50;
  const ratio = validPortions ? servingsCooked / recipe.servings : 1;

  const confirm = () => {
    const lines = recipe.ingredients
      .filter((ingredient) => isDecrementable(ingredient) && (checked[ingredient.id] ?? false))
      .map((ingredient) => ({
        ingredientId: ingredient.id,
        productId: needsProductSelection(ingredient) ? selectedProduct[ingredient.id] : undefined,
      }));
    onConfirm({ servingsCooked, lines, stars });
  };

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Portions réalisées"
        // Champ texte et non « number » : le clavier décimal français
        // produit une virgule, qu'un champ numérique rejette en silence.
        type="text"
        inputMode="numeric"
        value={raw === '' ? String(servingsCooked) : raw}
        onChange={(event) => onPortionsTyped(event.target.value)}
        disabled={busy}
        className="w-28"
      />

      <ul className="flex flex-col divide-y divide-line rounded-card bg-raised">
        {recipe.ingredients.map((ingredient) => {
          if (!isDecrementable(ingredient)) {
            return (
              <li key={ingredient.id} className="flex items-center gap-3 px-3 py-2 opacity-50">
                <span className="min-h-touch flex-1 text-[15px] leading-tight">{ingredient.label}</span>
                <span className="text-[13px] text-faint">Hors inventaire</span>
              </li>
            );
          }
          const scaled = ingredient.quantity === null || ingredient.unit === null ? null : roundQuantity(ingredient.quantity * ratio);
          return (
            <li key={ingredient.id} className="flex flex-col gap-2 px-3 py-2">
              <Checkbox
                label={ingredient.label}
                hint={scaled !== null && ingredient.unit !== null ? formatQuantity(scaled, ingredient.unit) : undefined}
                checked={checked[ingredient.id] ?? false}
                disabled={busy}
                onChange={(event) => setChecked((prev) => ({ ...prev, [ingredient.id]: event.target.checked }))}
              />
              {needsProductSelection(ingredient) && (
                <Select
                  label={`Produit pour ${ingredient.label}`}
                  value={selectedProduct[ingredient.id] ?? ''}
                  disabled={busy || !(checked[ingredient.id] ?? false)}
                  onChange={(event) => setSelectedProduct((prev) => ({ ...prev, [ingredient.id]: event.target.value }))}
                  options={ingredient.candidates.map((candidate) => ({ value: candidate.productId, label: candidate.name }))}
                />
              )}
            </li>
          );
        })}
      </ul>

      <div>
        <p className="mb-1 text-[14px] font-medium">Note (facultatif)</p>
        <StarRating value={stars} onChange={setStars} disabled={busy} />
        <p className="mt-1 text-[13px] text-faint">Modifiable pendant sept jours depuis l’historique de la recette.</p>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
          Annuler
        </Button>
        <Button variant="primary" className="flex-[2]" loading={busy} disabled={!validPortions} onClick={confirm}>
          Cuisiner
        </Button>
      </div>
    </div>
  );
}

interface CookSheetProps {
  open: boolean;
  recipe: RecipeDto | null;
  onClose: () => void;
  /** Appelé après une cuisson réussie, pour que l'appelant invalide ce qui lui appartient. */
  onCooked?: () => void;
}

/**
 * Tiroir de cuisson branché : `POST /api/v1/recipes/{id}/cook`. Un
 * `clientOpId` est tiré une seule fois par ouverture (une nouvelle cuisson),
 * et conservé pour toute nouvelle tentative de la même cuisson (double
 * appui, réseau lent) afin que le rejeu ne décrémente jamais deux fois.
 */
export function CookSheet({ open, recipe, onClose, onCooked }: CookSheetProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [clientOpId, setClientOpId] = useState(() => newClientOpId());

  useEffect(() => {
    if (open) setClientOpId(newClientOpId());
  }, [open]);

  if (!recipe) return null;

  const confirm = async (payload: CookConfirmPayload) => {
    setBusy(true);
    try {
      const input: CookRecipeInput = {
        servingsCooked: payload.servingsCooked,
        lines: payload.lines,
        stars: payload.stars,
        clientOpId,
      };
      const result: CookResult = await recipesApi.cookRecipe(recipe.id, input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.recipe(recipe.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recipeLogs(recipe.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recipesAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.pendingRating }),
      ]);
      const cappedCount = result.lines.filter((line) => line.capped).length;
      toast.show({
        message:
          cappedCount > 0
            ? `Réalisation enregistrée : le stock n’a pas suffi pour ${cappedCount} ingrédient${cappedCount > 1 ? 's' : ''}, décompté au maximum disponible.`
            : 'Réalisation enregistrée',
        tone: cappedCount > 0 ? 'neutral' : 'success',
        durationMs: cappedCount > 0 ? 6000 : 3000,
      });
      onCooked?.();
      onClose();
    } catch (error) {
      toast.show({ message: errorMessage(error, 'Cuisson impossible'), tone: 'danger', durationMs: 6000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} locked={busy} title={`Cuisiner ${recipe.title}`}>
      <CookSheetView recipe={recipe} busy={busy} onConfirm={(payload) => void confirm(payload)} onCancel={onClose} />
    </Sheet>
  );
}
