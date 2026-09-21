import { zodResolver } from '@hookform/resolvers/zod';
import {
  createProductSchema,
  dateTypeSchema,
  isoDateSchema,
  positiveQuantitySchema,
  unitSchema,
  type ProductDto,
  type ScanImageResult,
  type StockWriteResult,
} from '@kitchen/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { Checkbox, Input, Select } from '../../components/ui/input';
import { api, errorMessage, isApiError } from '../../lib/api';
import { flattenLocations, useCategoriesQuery, useLocationsQuery } from '../../lib/queries';
import { UNIT_OPTIONS } from '../../lib/quantity-ui';
import { stockApi } from '../../lib/stock-api';
import { DATE_TYPE_OPTIONS } from '../item/date-sheet';

/**
 * Fiche de création : schéma produit partagé, étendu des champs du lot initial.
 * Composition de briques de `@kitchen/shared`, jamais une redéfinition.
 */
const productFormSchema = createProductSchema.extend({
  quantity: positiveQuantitySchema.default(1),
  unit: unitSchema.optional(),
  expiryDate: isoDateSchema.nullable().optional(),
  dateType: dateTypeSchema.nullable().optional(),
  estimateExpiry: z.boolean().default(false),
  locationId: z.string().min(1, { message: 'Choisissez un emplacement' }),
});

type FormInput = z.input<typeof productFormSchema>;
type FormOutput = z.output<typeof productFormSchema>;

export interface ProductFormDefaults {
  barcode?: string | null;
  name?: string;
  originalName?: string | null;
  brand?: string | null;
  categoryId?: string | null;
  expiryDate?: string | null;
  imagePath?: string | null;
  recognitionLogId?: string;
  locationId?: string;
}

export interface ProductFormResult {
  product: ProductDto;
  stock: StockWriteResult;
}

interface ProductFormProps {
  defaults: ProductFormDefaults;
  /** Résultat de la vision : marque les champs « à vérifier » si la confiance est moyenne. */
  recognition?: ScanImageResult | null;
  /** Vrai quand l'emplacement vient de la session de scan : le champ est alors masqué. */
  lockLocation?: boolean;
  onSaved: (result: ProductFormResult) => void;
  onCancel?: () => void;
}

export function ProductForm({ defaults, recognition, lockLocation = false, onSaved, onCancel }: ProductFormProps) {
  const categories = useCategoriesQuery();
  const locations = useLocationsQuery();
  const [serverError, setServerError] = useState<string | null>(null);
  const review = recognition?.needsReview === true;

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: defaults.name ?? '',
      barcode: defaults.barcode ?? null,
      originalName: defaults.originalName ?? null,
      brand: defaults.brand ?? null,
      categoryId: defaults.categoryId ?? null,
      defaultUnit: 'PIECE',
      quantity: 1,
      expiryDate: defaults.expiryDate ?? null,
      dateType: defaults.expiryDate ? 'USE_BY' : null,
      estimateExpiry: false,
      locationId: defaults.locationId ?? '',
      imagePath: defaults.imagePath ?? null,
      recognitionLogId: defaults.recognitionLogId,
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const { quantity, unit, expiryDate, dateType, estimateExpiry, locationId, ...productInput } = values;
      const product = await api.post<ProductDto>('/products', productInput);
      const stock = await stockApi.create({
        productId: product.id,
        locationId,
        quantity,
        unit: unit ?? product.defaultUnit,
        expiryDate: expiryDate ?? null,
        dateType: expiryDate ? (dateType ?? 'USE_BY') : null,
        estimateExpiry: !expiryDate && estimateExpiry,
      });
      onSaved({ product, stock });
    } catch (error) {
      if (isApiError(error, 'conflict')) setServerError(`${error.message} Recherchez-le dans le stock plutôt que de le recréer.`);
      else if (isApiError(error, 'validation_failed')) setServerError(`Champs invalides : ${errorMessage(error)}`);
      else setServerError(errorMessage(error));
    }
  });

  const categoryOptions = (categories.data ?? []).map((category) => ({ value: category.id, label: `${category.icon ?? ''} ${category.name}`.trim() }));
  const locationOptions = flattenLocations(locations.data ?? []).map((location) => ({ value: location.id, label: `${'  '.repeat(location.depth)}${location.name}` }));
  const errors = form.formState.errors;
  const nullable = { setValueAs: (v: string) => (v === '' ? null : v) };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {recognition && (
        <p className={`rounded-xl px-3 py-2 text-[14px] ${review ? 'bg-soon-deep text-soon' : 'bg-accent-deep text-accent'}`}>
          {review
            ? `Reconnaissance à ${Math.round(recognition.confidence * 100)} % : vérifiez les champs signalés avant d’enregistrer.`
            : `Reconnu à ${Math.round(recognition.confidence * 100)} %${recognition.suggestion.category ? ` — catégorie proposée : ${recognition.suggestion.category}` : ''}.`}
        </p>
      )}
      <Input label="Nom" autoFocus={!defaults.name} review={review} error={errors.name?.message} {...form.register('name')} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Marque" review={review} error={errors.brand?.message} {...form.register('brand', nullable)} />
        <Input label="Nom d’origine" hint="Étiquette non latine" review={review} error={errors.originalName?.message} {...form.register('originalName', nullable)} />
      </div>
      <Select
        label="Catégorie"
        options={categoryOptions}
        placeholder="Sans catégorie"
        review={review}
        hint={recognition?.suggestion.category && !recognition.categoryId ? `Proposée : ${recognition.suggestion.category}` : undefined}
        error={errors.categoryId?.message}
        {...form.register('categoryId', nullable)}
      />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Quantité" type="number" inputMode="decimal" step="0.01" min="0.01" error={errors.quantity?.message} {...form.register('quantity', { valueAsNumber: true })} />
        <Select label="Unité" options={UNIT_OPTIONS} error={errors.defaultUnit?.message} {...form.register('defaultUnit')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Date de péremption" type="date" review={review && Boolean(defaults.expiryDate)} error={errors.expiryDate?.message} {...form.register('expiryDate', nullable)} />
        <Select label="Type" options={DATE_TYPE_OPTIONS} error={errors.dateType?.message} {...form.register('dateType', nullable)} />
      </div>
      <Checkbox label="Estimer la date depuis la catégorie" hint="Périssable non emballé sans date lisible (décision 6)." {...form.register('estimateExpiry')} />
      {!lockLocation && (
        <Select label="Emplacement" options={locationOptions} placeholder="Choisir…" error={errors.locationId?.message} {...form.register('locationId')} />
      )}
      <Input label="Code-barres" inputMode="numeric" hint="Laissez vide pour le vrac, les bocaux et les restes." error={errors.barcode?.message} {...form.register('barcode', nullable)} />
      {serverError && (
        <p role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
          {serverError}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" size="lg" className="flex-1" onClick={onCancel} disabled={form.formState.isSubmitting}>
            Annuler
          </Button>
        )}
        <Button type="submit" variant="primary" size="lg" className="flex-[2]" loading={form.formState.isSubmitting}>
          Ajouter au stock
        </Button>
      </div>
    </form>
  );
}
