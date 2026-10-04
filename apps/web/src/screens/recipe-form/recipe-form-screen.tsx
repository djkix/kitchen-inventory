import {
  computeDifficulty,
  createRecipeSchema,
  DIET_LABELS_FR,
  DIETS,
  DIFFICULTY_LABELS_FR,
  DISH_TYPE_LABELS_FR,
  DISH_TYPES,
  type CreateRecipeInput,
  type Difficulty,
  type RecipeDto,
} from '@kitchen/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button, IconButton } from '../../components/ui/button';
import { ErrorState } from '../../components/ui/empty-state';
import { BackIcon, PlusIcon, TrashIcon } from '../../components/ui/icons';
import { Checkbox, Input, Select, Textarea } from '../../components/ui/input';
import { Sheet } from '../../components/ui/sheet';
import { Skeleton } from '../../components/ui/skeleton';
import { errorMessage, isApiError } from '../../lib/api';
import { queryKeys, useCuisinesQuery, useRecipeQuery } from '../../lib/queries';
import { recipesApi } from '../../lib/recipes-api';
import { emptyIngredientLine, ingredientLineFromDto, ingredientLineToInput, IngredientEditor, type IngredientLineValue } from './ingredient-editor';

type DishType = (typeof DISH_TYPES)[number];
type Diet = (typeof DIETS)[number];

const DIFFICULTY_OPTIONS: Difficulty[] = ['VERY_EASY', 'EASY', 'INTERMEDIATE', 'HARD'];

export interface DifficultyFieldProps {
  steps: string[];
  activeTime: number | null;
  prepMinutes: number | null;
  value: Difficulty | null;
  onChange: (value: Difficulty) => void;
}

/**
 * Difficulté (section 12) : suit `computeDifficulty` (packages/shared, jamais
 * recalculée ici) tant qu'elle n'a pas été corrigée à la main. Une correction
 * gèle la valeur : les modifications suivantes des étapes ou du temps actif
 * ne la font plus bouger (A20).
 */
export function DifficultyField({ steps, activeTime, prepMinutes, value, onChange }: DifficultyFieldProps) {
  const [editing, setEditing] = useState(false);
  const computed = computeDifficulty({ steps, activeTime, prepMinutes });
  const displayed = value ?? computed;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[14px] text-muted">Difficulté</p>
      {editing ? (
        <div className="flex flex-wrap gap-2">
          {DIFFICULTY_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={option === displayed ? 'primary' : 'outline'}
              onClick={() => {
                onChange(option);
                setEditing(false);
              }}
            >
              {DIFFICULTY_LABELS_FR[option]}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="text-[16px] font-medium">
            {DIFFICULTY_LABELS_FR[displayed]}
            {value !== null && <span className="ml-1 text-[13px] text-faint">(corrigée)</span>}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            Corriger
          </Button>
        </div>
      )}
    </div>
  );
}

/** Fiche recette (section 12) : modification d'une recette existante — la création se fait en conservant une suggestion (EF-26). */
export function RecipeFormScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const recipe = useRecipeQuery(id);

  if (recipe.isPending) return <RecipeFormSkeleton onBack={() => navigate(-1)} />;
  if (recipe.isError) {
    const missing = isApiError(recipe.error, 'not_found');
    return (
      <>
        <FormHeader title="Modifier la recette" onBack={() => navigate(-1)} />
        <ErrorState
          title={missing ? 'Recette introuvable' : undefined}
          message={missing ? 'Cette recette n’existe plus.' : errorMessage(recipe.error)}
          onRetry={missing ? undefined : () => void recipe.refetch()}
        />
      </>
    );
  }
  return <RecipeFormBody recipe={recipe.data} />;
}

function FormHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="safe-top sticky top-0 z-20 bg-ink/95 backdrop-blur">
      <div className="flex min-h-[56px] items-center gap-1 px-2">
        <IconButton label="Retour" onClick={onBack} className="rounded-xl text-fg active:bg-raised">
          <BackIcon />
        </IconButton>
        <div className="flex-1 py-2 pl-1">
          <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
        </div>
      </div>
    </header>
  );
}

function RecipeFormSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <>
      <FormHeader title=" " onBack={onBack} />
      <div className="flex flex-col gap-4 px-4" aria-busy>
        <Skeleton className="h-11 rounded-xl" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    </>
  );
}

function parseOptionalInt(raw: string): number | null {
  if (raw.trim() === '') return null;
  const parsed = Math.round(Number(raw.replace(',', '.')));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

interface IntFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}

/** Champ entier texte, clavier numérique : la virgule décimale française est tolérée (comme la quantité de stock). */
function IntField({ label, value, onChange }: IntFieldProps) {
  const [raw, setRaw] = useState(value === null ? '' : String(value));
  return (
    <Input
      label={label}
      type="text"
      inputMode="numeric"
      value={raw}
      onChange={(event) => {
        setRaw(event.target.value);
        onChange(parseOptionalInt(event.target.value));
      }}
    />
  );
}

function StepsEditor({ steps, onChange, error }: { steps: string[]; onChange: (steps: string[]) => void; error?: string }) {
  const update = (index: number, value: string) => onChange(steps.map((step, i) => (i === index ? value : step)));
  const remove = (index: number) => onChange(steps.filter((_, i) => i !== index));
  const add = () => onChange([...steps, '']);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[14px] text-muted">Étapes</p>
      {steps.map((step, index) => (
        <div key={index} className="flex items-start gap-2">
          <Textarea label={`Étape ${index + 1}`} className="flex-1" rows={2} value={step} onChange={(event) => update(index, event.target.value)} />
          <IconButton label={`Retirer l’étape ${index + 1}`} onClick={() => remove(index)} className="mt-6">
            <TrashIcon />
          </IconButton>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <Button type="button" variant="outline" size="sm" onClick={add} icon={<PlusIcon size={18} />}>
        Ajouter une étape
      </Button>
    </div>
  );
}

function CuisineField({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const cuisines = useCuisinesQuery();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = (cuisines.data ?? []).map((cuisine) => ({ value: cuisine.id, label: cuisine.name }));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await recipesApi.createCuisine({ name: name.trim() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.cuisines });
      onChange(created.id);
      setCreating(false);
      setName('');
    } catch (err) {
      setError(errorMessage(err, 'Création impossible'));
    } finally {
      setBusy(false);
    }
  };

  if (creating) {
    return (
      <div className="flex flex-col gap-2">
        <Input label="Nouvelle cuisine" value={name} autoFocus error={error ?? undefined} onChange={(event) => setName(event.target.value)} />
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setCreating(false)} disabled={busy}>
            Annuler
          </Button>
          <Button type="button" variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void create()}>
            Créer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2">
      <Select
        label="Cuisine"
        className="flex-1"
        placeholder="Sans cuisine"
        options={options}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
        Nouvelle
      </Button>
    </div>
  );
}

interface RecipeFormBodyProps {
  recipe: RecipeDto;
}

/** Corps du formulaire, une fois la recette chargée : toujours une modification (EF-26). */
function RecipeFormBody({ recipe }: RecipeFormBodyProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState(recipe.title);
  const [cuisineId, setCuisineId] = useState<string | null>(recipe.cuisineId);
  const [dishType, setDishType] = useState<DishType | null>(recipe.dishType);
  const [servings, setServings] = useState<number | null>(recipe.servings);
  const [prepMinutes, setPrepMinutes] = useState<number | null>(recipe.prepMinutes);
  const [cookMinutes, setCookMinutes] = useState<number | null>(recipe.cookMinutes);
  const [restMinutes, setRestMinutes] = useState<number | null>(recipe.restMinutes);
  const [activeTime, setActiveTime] = useState<number | null>(recipe.activeTime);
  const [steps, setSteps] = useState<string[]>(recipe.steps.length > 0 ? recipe.steps : ['']);
  const [diets, setDiets] = useState<Diet[]>(recipe.diets);
  const [difficultyOverride, setDifficultyOverride] = useState<Difficulty | null>(recipe.difficultyOverride ? recipe.difficulty : null);
  const [ingredients, setIngredients] = useState<IngredientLineValue[]>(() =>
    recipe.ingredients.length > 0 ? recipe.ingredients.map(ingredientLineFromDto) : [emptyIngredientLine()],
  );

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const snapshot = () =>
    JSON.stringify({ title, cuisineId, dishType, servings, prepMinutes, cookMinutes, restMinutes, activeTime, steps, diets, difficultyOverride, ingredients });
  const initialSnapshot = useRef<string | null>(null);
  if (initialSnapshot.current === null) initialSnapshot.current = snapshot();
  const dirty = snapshot() !== initialSnapshot.current;

  const leaveTarget = `/recettes/${recipe.id}`;
  const leaveNow = () => navigate(leaveTarget);
  const requestLeave = () => (dirty ? setConfirmLeave(true) : leaveNow());

  // Fermeture d'onglet ou rechargement avec des modifications non enregistrées : le navigateur demande confirmation.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const buildPayload = (): CreateRecipeInput => {
    const base = {
      title: title.trim(),
      cuisineId,
      dishType,
      prepMinutes,
      cookMinutes,
      restMinutes,
      activeTime,
      servings: servings ?? Number.NaN,
      steps,
      diets,
      ingredients: ingredients.map(ingredientLineToInput),
    };
    return difficultyOverride !== null ? { ...base, difficulty: difficultyOverride } : base;
  };

  const submit = async () => {
    setServerError(null);
    const parsed = createRecipeSchema.safeParse(buildPayload());
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message])));
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      const saved = await recipesApi.updateRecipe(recipe.id, parsed.data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.recipesAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recipe(saved.id) }),
      ]);
      initialSnapshot.current = snapshot();
      navigate(`/recettes/${saved.id}`, { replace: true });
    } catch (error) {
      setServerError(errorMessage(error, 'Enregistrement impossible'));
    } finally {
      setSaving(false);
    }
  };

  const ingredientErrors = Object.fromEntries(
    Object.entries(fieldErrors)
      .map(([key, message]): [string, string] | null => {
        const match = /^ingredients\.(\d+)/.exec(key);
        return match ? [match[1]!, message] : null;
      })
      .filter((entry): entry is [string, string] => entry !== null)
      .map(([index, message]): [number, string] => [Number(index), message]),
  );

  const topLevelErrors = Object.entries(fieldErrors).filter(([key]) => !key.startsWith('ingredients.') && key !== 'title' && key !== 'steps');

  return (
    <>
      <FormHeader title="Modifier la recette" onBack={requestLeave} />

      <div className="flex flex-col gap-5 px-4 pb-32">
        {serverError && (
          <p role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
            {serverError}
          </p>
        )}
        {topLevelErrors.length > 0 && (
          <ul role="alert" className="rounded-xl bg-danger-deep px-3 py-2 text-[14px] text-danger">
            {topLevelErrors.map(([key, message]) => (
              <li key={key}>{message}</li>
            ))}
          </ul>
        )}

        <Input label="Titre" value={title} autoFocus error={fieldErrors.title} onChange={(event) => setTitle(event.target.value)} />

        <CuisineField value={cuisineId} onChange={setCuisineId} />

        <Select
          label="Type de plat"
          placeholder="Non précisé"
          options={DISH_TYPES.map((type) => ({ value: type, label: DISH_TYPE_LABELS_FR[type] }))}
          value={dishType ?? ''}
          onChange={(event) => setDishType(event.target.value === '' ? null : (event.target.value as DishType))}
        />

        <div>
          <p className="mb-2 text-[14px] text-muted">Régimes</p>
          <div className="flex flex-wrap gap-2">
            {DIETS.map((diet) => (
              <Checkbox
                key={diet}
                label={DIET_LABELS_FR[diet]}
                checked={diets.includes(diet)}
                onChange={(event) =>
                  setDiets(event.target.checked ? [...diets, diet] : diets.filter((d) => d !== diet))
                }
              />
            ))}
          </div>
        </div>

        <IntField label="Portions" value={servings} onChange={setServings} />

        <div className="grid grid-cols-2 gap-3">
          <IntField label="Préparation (min)" value={prepMinutes} onChange={setPrepMinutes} />
          <IntField label="Cuisson (min)" value={cookMinutes} onChange={setCookMinutes} />
          <IntField label="Temps actif (min)" value={activeTime} onChange={setActiveTime} />
          <IntField label="Repos (min)" value={restMinutes} onChange={setRestMinutes} />
        </div>

        <DifficultyField steps={steps} activeTime={activeTime} prepMinutes={prepMinutes} value={difficultyOverride} onChange={setDifficultyOverride} />

        <StepsEditor steps={steps} onChange={setSteps} error={fieldErrors.steps} />

        <section>
          <h2 className="mb-2 px-1 text-[13px] font-semibold text-muted">Ingrédients</h2>
          <IngredientEditor lines={ingredients} onChange={setIngredients} errors={ingredientErrors} />
        </section>
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pb-3 pt-6">
        <div className="flex gap-2">
          <Button size="lg" className="flex-1" onClick={requestLeave} disabled={saving}>
            Annuler
          </Button>
          <Button variant="primary" size="lg" className="flex-[2]" loading={saving} onClick={() => void submit()}>
            Enregistrer
          </Button>
        </div>
      </div>

      <Sheet
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Abandonner ces modifications ?"
        description="Les changements non enregistrés seront perdus."
      >
        <div className="flex gap-2">
          <Button block variant="secondary" onClick={() => setConfirmLeave(false)}>
            Continuer la saisie
          </Button>
          <Button block variant="danger" onClick={leaveNow}>
            Abandonner
          </Button>
        </div>
      </Sheet>
    </>
  );
}
