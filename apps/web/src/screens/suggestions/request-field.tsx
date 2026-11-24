import { RECIPE_REQUEST_MAX_CHARS } from '@kitchen/shared';
import { useState, type FormEvent, type ReactNode } from 'react';

/**
 * La demande, en clair (spécification du 2026-11-24) : « une recette asiatique
 * avec de la cacahuète, des échalotes et de l'ail ».
 *
 * Remplace le champ à pastilles du 2026-10-19. Les pastilles découpaient la
 * saisie en ingrédients imposés, ce qui était utile pour écouler un reste mais
 * ne sait rien dire d'une envie — « un plat qui réchauffe », « quelque chose
 * de rapide ce soir ». Le modèle, lui, comprend la phrase entière : elle part
 * donc telle quelle, sans découpage, sans autocomplétion, sans normalisation.
 *
 * C'est ce champ qui décide du chemin, et c'est tout son rôle : une phrase
 * tapée demande UNE recette, un champ vide laisse partir la fournée filtrée.
 */
export function RequestField({
  onSubmit,
  busy,
  trailing,
}: {
  /** La phrase telle quelle, ou une chaîne vide quand le champ n'a rien. */
  onSubmit: (text: string) => void;
  busy: boolean;
  /**
   * Contrôle posé à droite de « Chercher », sur la même ligne : le bouton
   * « Filtres » de l'écran Suggestions. Une place, pas une responsabilité.
   */
  trailing?: ReactNode;
}) {
  const [text, setText] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(text.trim());
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1 px-4 pb-2">
      <div className="flex items-start gap-1.5">
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={RECIPE_REQUEST_MAX_CHARS}
          aria-label="Votre demande"
          placeholder="une recette asiatique à la cacahuète"
          // `search` : le clavier du téléphone affiche alors une touche de
          // validation explicite, seul moyen de soumettre sans bouton visible.
          enterKeyHint="search"
          className="min-h-touch w-full min-w-0 flex-1 truncate rounded-xl border border-line bg-surface px-3 text-[14px] text-fg focus:border-accent focus:outline-none"
        />
        <button type="submit" disabled={busy} className="min-h-touch shrink-0 rounded-xl bg-accent px-3 text-[14px] font-semibold text-ink disabled:opacity-50">
          Chercher
        </button>
        {trailing}
      </div>
    </form>
  );
}
