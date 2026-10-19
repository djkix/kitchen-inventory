import { suggestionIngredientsSchema } from '@kitchen/shared';
import { useState, type FormEvent } from 'react';

/**
 * Ingrédients dictés à la main (spécification du 2026-10-19, D6, D7) : « j'ai
 * des pommes de terre et un reste de merguez ». Du texte libre, pas une
 * sélection dans l'inventaire — un reste n'a pas de code-barres, il est né du
 * repas d'hier, et c'est précisément ce que le stock ne sait pas dire.
 *
 * Une seule ligne, au-dessus des filtres, vide par défaut (D6) : l'écran a
 * déjà été allégé deux fois à la demande de djkix, un panneau de saisie y
 * reprendrait l'espace rendu. Vide, le champ ne change strictement rien.
 *
 * La saisie n'est validée qu'ici, par le schéma Zod partagé : les bornes de D7
 * (cinq ingrédients, trente caractères) vivent dans `packages/shared` et sont
 * les mêmes que celles du serveur, jamais recopiées.
 */
export function IngredientsField({ value, onChange }: { value: string; onChange: (raw: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = suggestionIngredientsSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Saisie non valide');
      return;
    }
    setError(null);
    // La saisie brute part telle quelle : c'est le serveur qui normalise et
    // trie (D3), avec ce même schéma. L'écran n'en garde que l'affichage.
    onChange(draft.trim());
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1 px-4 pb-2">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Ingrédients à utiliser"
          // `search` : le clavier du téléphone affiche alors une touche de
          // validation explicite, seul moyen de soumettre sans bouton visible.
          enterKeyHint="search"
          placeholder="pommes de terre, merguez"
          className="min-h-touch min-w-0 flex-1 truncate rounded-xl border border-line bg-surface px-3 text-[14px] text-fg focus:border-accent focus:outline-none"
        />
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
