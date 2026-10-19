import { splitIngredientTerms, suggestionIngredientsSchema } from '@kitchen/shared';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useDebouncedValue } from '../../hooks/use-debounced-value';
import { useProductsQuery } from '../../lib/queries';

/**
 * Ingrédients dictés à la main (spécification du 2026-10-19, D6, D7) : « j'ai
 * des pommes de terre et un reste de merguez ». Du texte libre, pas une
 * sélection dans l'inventaire — un reste n'a pas de code-barres, il est né du
 * repas d'hier, et c'est précisément ce que le stock ne sait pas dire.
 *
 * Des **pastilles**, depuis le 2026-10-19 : djkix a tapé « poulet tomate »
 * sans virgule, l'application a compris un seul ingrédient de ce nom, et rien
 * à l'écran ne le disait — il a lu « Aucune recette avec ces ingrédients »
 * après avoir payé l'appel au modèle. Chaque terme validé (Entrée ou virgule)
 * devient une pastille visible et retirable : le découpage n'est plus
 * invisible.
 *
 * L'**autocomplétion** vient du catalogue de produits (`useProductsQuery`, la
 * même recherche approximative qu'ailleurs). Elle ne sert pas que le confort :
 * un terme choisi dans la liste porte exactement un libellé connu, donc le
 * rapprochement au réservoir ne dépend plus de l'orthographe du jour. Elle
 * propose, elle n'impose jamais — « reste de merguez » n'est dans aucun
 * catalogue, et c'est l'exemple qui a motivé la fonctionnalité.
 *
 * Le contrat avec le serveur ne change pas : les termes repartent en une
 * chaîne séparée par des virgules, validée par le schéma Zod partagé. Les
 * bornes de D7 (cinq ingrédients, trente caractères) vivent dans
 * `packages/shared` et sont vérifiées ici **avant** l'envoi, pour dire
 * pourquoi un terme est refusé au lieu de laisser le serveur rejeter.
 */
export function IngredientsField({ value, onChange }: { value: string; onChange: (raw: string) => void }) {
  const [terms, setTerms] = useState<string[]>(() => splitIngredientTerms(value));
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Option survolée au clavier ; -1 = aucune, la saisie libre reste ce qui part. */
  const [activeIndex, setActiveIndex] = useState(-1);
  /** Liste fermée par Échap, jusqu'à la frappe suivante. */
  const [dismissed, setDismissed] = useState(false);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-${index}`;

  const products = useProductsQuery(useDebouncedValue(draft.trim(), 300));
  const options = (products.data?.items ?? [])
    .map((product) => product.name)
    // Proposer un terme déjà posé en pastille ne mène qu'à un doublon refusé.
    .filter((name) => !terms.some((term) => term.toLowerCase() === name.toLowerCase()))
    .slice(0, 6);
  const open = !dismissed && draft.trim().length > 0 && options.length > 0;

  /** Ajoute des termes si les bornes partagées le permettent ; dit pourquoi sinon. */
  const addTerms = (added: string[]): boolean => {
    // Un terme déjà posé n'en fait pas une seconde pastille : il consommerait
    // une place sur cinq pour la même demande.
    const fresh = added.filter((term, index) => {
      const folded = term.toLowerCase();
      return !terms.some((other) => other.toLowerCase() === folded) && added.findIndex((t) => t.toLowerCase() === folded) === index;
    });
    if (fresh.length === 0) return true;
    const candidate = [...terms, ...fresh];
    const parsed = suggestionIngredientsSchema.safeParse(candidate.join(', '));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Saisie non valide');
      return false;
    }
    setTerms(candidate);
    setError(null);
    return true;
  };

  const commitDraft = () => {
    if (addTerms(splitIngredientTerms(draft))) setDraft('');
  };

  const typed = (raw: string) => {
    setDismissed(false);
    setActiveIndex(-1);
    // La virgule valide, où qu'elle vienne : clavier, dictée ou collage. Seul
    // le fragment qui la suit reste en cours de saisie.
    if (!raw.includes(',')) {
      setDraft(raw);
      return;
    }
    const parts = raw.split(',');
    const last = parts.pop() ?? '';
    if (addTerms(splitIngredientTerms(parts.join(',')))) setDraft(last.trimStart());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && open) {
      setDismissed(true);
      setActiveIndex(-1);
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && open) {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? activeIndex + 1 : activeIndex - 1;
      setActiveIndex(((next % options.length) + options.length) % options.length);
      return;
    }
    if (event.key === 'Backspace' && draft === '' && terms.length > 0) {
      // Geste attendu de ce type de champ : le retour arrière mange la
      // dernière pastille quand il n'y a plus de texte à effacer.
      setTerms(terms.slice(0, -1));
      setError(null);
      return;
    }
    if (event.key === 'Enter') {
      const chosen = open && activeIndex >= 0 ? options[activeIndex] : undefined;
      if (chosen !== undefined) {
        event.preventDefault();
        if (addTerms([chosen])) setDraft('');
        setActiveIndex(-1);
        return;
      }
      if (draft.trim() !== '') {
        // Entrée valide le terme ; elle ne lance pas la recherche, sans quoi
        // le geste décrit par la demande coûterait un appel par pastille.
        event.preventDefault();
        commitDraft();
      }
      // Champ vide : Entrée laisse le formulaire partir, c'est « Chercher ».
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Piège classique du motif : le terme tapé mais non validé au moment où on
    // lance la recherche. Il part avec les autres.
    const pending = splitIngredientTerms(draft);
    const candidate = [...terms, ...pending];
    const parsed = suggestionIngredientsSchema.safeParse(candidate.join(', '));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Saisie non valide');
      return;
    }
    setTerms(candidate);
    setDraft('');
    setError(null);
    setDismissed(true);
    // Aucun terme = aucune contrainte (D7, tour de correction 1) : une chaîne
    // vide, jamais une liste vide expliquée par une « combinaison trop rare ».
    onChange(candidate.join(', '));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1 px-4 pb-2">
      <div className="flex items-start gap-1.5">
        <div className="relative min-w-0 flex-1">
          {terms.length > 0 && (
            <ul className="mb-1 flex flex-wrap gap-1.5">
              {terms.map((term) => (
                <li key={term} className="flex items-center gap-1 rounded-full bg-raised py-1 pl-3 pr-1 text-[13px] text-fg">
                  <span>{term}</span>
                  <button
                    type="button"
                    // Le nom nomme la pastille : « Retirer » seul, répété cinq
                    // fois, ne dit pas laquelle part.
                    aria-label={`Retirer ${term}`}
                    onClick={() => {
                      setTerms(terms.filter((other) => other !== term));
                      setError(null);
                    }}
                    className="flex size-6 items-center justify-center rounded-full text-muted active:bg-surface"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            type="text"
            value={draft}
            onChange={(event) => typed(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Ingrédients à utiliser"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            // `search` : le clavier du téléphone affiche alors une touche de
            // validation explicite, seul moyen de soumettre sans bouton visible.
            enterKeyHint="search"
            placeholder={terms.length > 0 ? 'autre ingrédient' : 'pommes de terre, merguez'}
            className="min-h-touch w-full truncate rounded-xl border border-line bg-surface px-3 text-[14px] text-fg focus:border-accent focus:outline-none"
          />
          {open && (
            // Superposée (`absolute`) : la liste ne doit pas pousser les
            // filtres et la liste de recettes vers le bas à chaque frappe.
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Produits proposés"
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-xl border border-line bg-surface shadow-lg"
            >
              {options.map((name, index) => (
                <li
                  key={name}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  // `onMouseDown` préventif : le clic ne doit pas perdre le
                  // focus du champ avant que le clic lui-même soit traité.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (addTerms([name])) setDraft('');
                    setActiveIndex(-1);
                  }}
                  className={`min-h-touch cursor-pointer px-3 py-2 text-[14px] ${index === activeIndex ? 'bg-raised' : ''}`}
                >
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" className="min-h-touch shrink-0 rounded-xl bg-accent px-3 text-[14px] font-semibold text-ink">
          Chercher
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
