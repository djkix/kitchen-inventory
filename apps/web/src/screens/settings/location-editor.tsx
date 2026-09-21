import { zodResolver } from '@hookform/resolvers/zod';
import { createLocationSchema, temperatureSchema, type CreateLocationInput, type LocationNode } from '@kitchen/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { Input, Select } from '../../components/ui/input';
import { Sheet } from '../../components/ui/sheet';
import { errorMessage } from '../../lib/api';
import { flattenLocations } from '../../lib/queries';

export type LocationEditorMode = { kind: 'create'; parentId: string | null } | { kind: 'edit'; node: LocationNode };

interface LocationEditorProps {
  mode: LocationEditorMode | null;
  tree: LocationNode[];
  onClose: () => void;
  onSubmit: (input: CreateLocationInput) => Promise<void>;
}

const TEMPERATURE_OPTIONS = [
  { value: 'ambient', label: 'Température ambiante' },
  { value: 'chilled', label: 'Réfrigéré' },
  { value: 'frozen', label: 'Congelé' },
];

const editorSchema = createLocationSchema.extend({ temperature: temperatureSchema.nullable().optional() });
type EditorInput = z.input<typeof editorSchema>;
type EditorOutput = z.output<typeof editorSchema>;

/** Création ou modification d'un emplacement : nom, parent, type, température (EF-06). */
export function LocationEditor({ mode, tree, onClose, onSubmit }: LocationEditorProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const editing = mode?.kind === 'edit' ? mode.node : null;
  const form = useForm<EditorInput, unknown, EditorOutput>({
    resolver: zodResolver(editorSchema),
    defaultValues: {
      name: editing?.name ?? '',
      parentId: editing ? editing.parentId : mode?.kind === 'create' ? mode.parentId : null,
      kind: editing?.kind ?? null,
      temperature: (editing?.temperature as EditorInput['temperature']) ?? null,
    },
  });

  if (!mode) return null;

  // Un emplacement ne peut pas devenir son propre descendant.
  const excluded = new Set<string>();
  if (editing) {
    const collect = (node: LocationNode) => {
      excluded.add(node.id);
      node.children.forEach(collect);
    };
    collect(editing);
  }
  const parentOptions = flattenLocations(tree)
    .filter((node) => !excluded.has(node.id))
    .map((node) => ({ value: node.id, label: `${'  '.repeat(node.depth)}${node.name}` }));

  const submit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await onSubmit(values);
      onClose();
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  const nullable = { setValueAs: (v: string) => (v === '' ? null : v) };
  const errors = form.formState.errors;

  return (
    <Sheet open onClose={onClose} locked={form.formState.isSubmitting} title={editing ? `Modifier ${editing.name}` : 'Nouvel emplacement'}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input label="Nom" autoFocus error={errors.name?.message} {...form.register('name')} placeholder="Placard du haut" />
        <Select label="Dans" options={parentOptions} placeholder="À la racine" error={errors.parentId?.message} {...form.register('parentId', nullable)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Type" hint="pièce, meuble, étagère…" error={errors.kind?.message} {...form.register('kind', nullable)} />
          <Select label="Température" options={TEMPERATURE_OPTIONS} placeholder="Non précisée" error={errors.temperature?.message} {...form.register('temperature', nullable)} />
        </div>
        {serverError && (
          <p role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
            {serverError}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={form.formState.isSubmitting}>
          {editing ? 'Enregistrer' : 'Créer'}
        </Button>
      </form>
    </Sheet>
  );
}
