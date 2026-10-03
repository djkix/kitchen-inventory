import type { CategoryDto, CreateRecipeInput, ProductDto, RecipeIngredientDto, Unit } from '@kitchen/shared';
import { useState } from 'react';
import { Button, IconButton } from '../../components/ui/button';
import { Checkbox, Input, Select } from '../../components/ui/input';
import { PlusIcon, TrashIcon } from '../../components/ui/icons';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { useCategoriesQuery, useProductsQuery } from '../../lib/queries';
import { UNIT_OPTIONS } from '../../lib/quantity-ui';

export type RecipeIngredientInput = CreateRecipeInput['ingredients'][number];

/** Ligne d'ingrédient éditée côté formulaire : un identifiant client stable en plus des champs de l'API. */
export interface IngredientLineValue {
  key: string;
  label: string;
  productId: string | null;
  productName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  quantity: number | null;
  unit: Unit | null;
  essential: boolean;
  substitutable: boolean;
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `ing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyIngredientLine(): IngredientLineValue {
  return {
    key: newKey(),
    label: '',
    productId: null,
    productName: null,
    categoryId: null,
    categoryName: null,
    quantity: null,
    unit: null,
    // Décochées par défaut (A1, A2) : voir recipeIngredientInputSchema.
    essential: false,
    substitutable: false,
  };
}

/** Reprend une ligne existante (modification) sans les champs qui ne servent qu'à la cuisson (candidates, state...). */
export function ingredientLineFromDto(ingredient: RecipeIngredientDto): IngredientLineValue {
  return {
    key: ingredient.id,
    label: ingredient.label,
    productId: ingredient.productId,
    productName: ingredient.productName,
    categoryId: ingredient.categoryId,
    categoryName: ingredient.categoryName,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    essential: ingredient.essential,
    substitutable: ingredient.substitutable,
  };
}

export function ingredientLineToInput(line: IngredientLineValue): RecipeIngredientInput {
  return {
    label: line.label.trim(),
    productId: line.productId,
    categoryId: line.categoryId,
    quantity: line.quantity,
    unit: line.unit,
    essential: line.essential,
    substitutable: line.substitutable,
  };
}

function parseOptionalQuantity(raw: string): number | null {
  if (raw.trim() === '') return null;
  // Virgule décimale française acceptée, comme le champ quantité du stock.
  const parsed = Number(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

interface IngredientEditorProps {
  lines: IngredientLineValue[];
  onChange: (lines: IngredientLineValue[]) => void;
  errors?: Record<number, string>;
}

/**
 * Liste des ingrédients d'une recette (EF-17) : chaque ligne se rattache à un
 * produit existant par la recherche déjà utilisée ailleurs (`useProductsQuery`,
 * même file d'attente que la liste des recettes et le stock), à une catégorie,
 * ou reste en texte libre — un cas normal, pas une erreur.
 */
export function IngredientEditor({ lines, onChange, errors }: IngredientEditorProps) {
  const update = (key: string, patch: Partial<IngredientLineValue>) => {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };
  const remove = (key: string) => onChange(lines.filter((line) => line.key !== key));
  const add = () => onChange([...lines, emptyIngredientLine()]);

  return (
    <div className="flex flex-col gap-3">
      {lines.map((line, index) => (
        <IngredientLineEditor key={line.key} line={line} error={errors?.[index]} onChange={(patch) => update(line.key, patch)} onRemove={() => remove(line.key)} />
      ))}
      <Button type="button" variant="outline" onClick={add} icon={<PlusIcon size={18} />}>
        Ajouter un ingrédient
      </Button>
    </div>
  );
}

interface IngredientLineEditorProps {
  line: IngredientLineValue;
  error?: string;
  onChange: (patch: Partial<IngredientLineValue>) => void;
  onRemove: () => void;
}

function IngredientLineEditor({ line, error, onChange, onRemove }: IngredientLineEditorProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const products = useProductsQuery(debouncedQuery);
  const categories = useCategoriesQuery();
  const [quantityRaw, setQuantityRaw] = useState(line.quantity === null ? '' : String(line.quantity));

  const onQuantityTyped = (value: string) => {
    setQuantityRaw(value);
    onChange({ quantity: parseOptionalQuantity(value) });
  };

  const attachProduct = (product: ProductDto) => {
    onChange({
      productId: product.id,
      productName: product.name,
      categoryId: null,
      categoryName: null,
      label: line.label.trim() ? line.label : product.name,
    });
    setSearchOpen(false);
    setQuery('');
  };

  const attachCategory = (category: CategoryDto) => {
    onChange({ categoryId: category.id, categoryName: category.name, productId: null, productName: null });
  };

  const detach = () => onChange({ productId: null, productName: null, categoryId: null, categoryName: null });

  const categoryOptions = (categories.data ?? []).map((category) => ({ value: category.id, label: `${category.icon ?? ''} ${category.name}`.trim() }));

  return (
    <div className="flex flex-col gap-3 rounded-card bg-surface p-3">
      <div className="flex items-start gap-2">
        <Input label="Libellé" value={line.label} error={error} className="flex-1" onChange={(event) => onChange({ label: event.target.value })} />
        <IconButton label="Retirer cet ingrédient" onClick={onRemove} className="mt-6">
          <TrashIcon />
        </IconButton>
      </div>

      {line.productId ? (
        <p className="text-[13px] text-muted">
          Produit : <strong className="text-fg">{line.productName}</strong>{' '}
          <button type="button" className="text-accent underline" onClick={detach}>
            Détacher
          </button>
        </p>
      ) : line.categoryId ? (
        <p className="text-[13px] text-muted">
          Catégorie : <strong className="text-fg">{line.categoryName}</strong>{' '}
          <button type="button" className="text-accent underline" onClick={detach}>
            Détacher
          </button>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setSearchOpen((open) => !open)}>
              Lier à un produit
            </Button>
            <Select
              label="Catégorie"
              className="min-w-[160px] flex-1"
              placeholder="Lier à une catégorie"
              value=""
              options={categoryOptions}
              onChange={(event) => {
                const category = (categories.data ?? []).find((c) => c.id === event.target.value);
                if (category) attachCategory(category);
              }}
            />
          </div>
          {searchOpen && (
            <div className="flex flex-col gap-1">
              <Input label="Rechercher un produit" value={query} autoFocus onChange={(event) => setQuery(event.target.value)} />
              {query.trim() !== '' && products.isSuccess && (
                <ul className="flex flex-col divide-y divide-line rounded-xl bg-raised">
                  {products.data.items.length === 0 ? (
                    <li className="px-3 py-2 text-[13px] text-faint">Aucun produit trouvé</li>
                  ) : (
                    products.data.items.map((product) => (
                      <li key={product.id}>
                        <button type="button" className="block min-h-touch w-full px-3 py-2 text-left text-[14px]" onClick={() => attachProduct(product)}>
                          {product.name}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Input
          label="Quantité"
          type="text"
          inputMode="decimal"
          value={quantityRaw}
          onChange={(event) => onQuantityTyped(event.target.value)}
        />
        <Select
          label="Unité"
          placeholder="—"
          options={UNIT_OPTIONS}
          value={line.unit ?? ''}
          onChange={(event) => onChange({ unit: event.target.value === '' ? null : (event.target.value as Unit) })}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Checkbox label="Essentiel" checked={line.essential} onChange={(event) => onChange({ essential: event.target.checked })} />
        <Checkbox label="Substituable" checked={line.substitutable} onChange={(event) => onChange({ substitutable: event.target.checked })} />
      </div>
    </div>
  );
}
