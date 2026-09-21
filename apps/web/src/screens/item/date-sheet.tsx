import { zodResolver } from '@hookform/resolvers/zod';
import { updateStockItemSchema, type StockItemDto, type UpdateStockItemInput } from '@kitchen/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../../components/ui/button';
import { Checkbox, Input, Select } from '../../components/ui/input';
import { Sheet } from '../../components/ui/sheet';
import { errorMessage } from '../../lib/api';

interface DateSheetProps {
  item: StockItemDto;
  open: boolean;
  onClose: () => void;
  onConfirm: (input: UpdateStockItemInput) => Promise<void>;
}

export const DATE_TYPE_OPTIONS = [
  { value: 'USE_BY', label: 'DLC — à consommer jusqu’au' },
  { value: 'BEST_BEFORE', label: 'DDM — de préférence avant' },
];

/** Modification de la date, de son type et de son caractère estimé (`PATCH /stock/:id`). */
export function DateSheet({ item, open, onClose, onConfirm }: DateSheetProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<UpdateStockItemInput>({
    resolver: zodResolver(updateStockItemSchema),
    defaultValues: { expiryDate: item.expiryDate ?? null, dateType: item.dateType ?? 'USE_BY', dateEstimated: item.dateEstimated },
  });

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await onConfirm({
        expiryDate: values.expiryDate ? values.expiryDate : null,
        dateType: values.expiryDate ? values.dateType : null,
        dateEstimated: values.expiryDate ? values.dateEstimated : false,
      });
      onClose();
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  return (
    <Sheet open={open} onClose={onClose} locked={form.formState.isSubmitting} title="Date de péremption" description={item.product.name}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input label="Date" type="date" error={form.formState.errors.expiryDate?.message} {...form.register('expiryDate', { setValueAs: (v: string) => (v === '' ? null : v) })} />
        <Select label="Type de date" options={DATE_TYPE_OPTIONS} error={form.formState.errors.dateType?.message} {...form.register('dateType')} />
        <Checkbox label="Date estimée" hint="Périssable non emballé : la date sert à classer, jamais à exclure." {...form.register('dateEstimated')} />
        {serverError && (
          <p role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
            {serverError}
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <Button variant="ghost" className="flex-1" onClick={() => void onConfirm({ expiryDate: null, dateType: null, dateEstimated: false }).then(onClose)}>
            Retirer la date
          </Button>
          <Button type="submit" variant="primary" className="flex-[2]" loading={form.formState.isSubmitting}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
