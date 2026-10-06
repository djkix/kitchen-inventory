import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage } from '../../lib/api';
import { queryKeys, useAvailableModelsQuery, useSettingsQuery } from '../../lib/queries';
import type { Settings } from '@kitchen/shared';

/** Clés de `Settings` qui désignent un modèle : les seules que cette ligne sait écrire. */
type ModelKey = 'visionModel' | 'suggestionModel';

/**
 * Choix du modèle d'un usage (reconnaissance photo, recettes), réservé aux
 * administrateurs. La liste vient de la clé configurée (`GET /settings/models`)
 * et non d'une table figée dans le code : un nom de modèle inventé est la panne
 * qui a laissé l'écran Suggestions vide du 2026-10-04 au 2026-10-06, et un
 * catalogue écrit à la main aurait vieilli de la même façon.
 *
 * Le choix « Défaut du serveur » efface la valeur en base et rend la main à la
 * variable d'environnement puis au défaut du code : sans lui, un réglage posé
 * une fois ne pourrait plus être annulé depuis l'application.
 */
export function ModelRow({ label, hint, settingKey, isAdmin }: { label: string; hint: string; settingKey: ModelKey; isAdmin: boolean }) {
  const settings = useSettingsQuery();
  const models = useAvailableModelsQuery(isAdmin);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const current = settings.data?.[settingKey] ?? '';

  const save = async (next: string) => {
    setSaving(true);
    try {
      await api.patch<Settings>('/settings', { [settingKey]: next });
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      toast.show({ message: next === '' ? 'Modèle remis au défaut du serveur' : `Modèle : ${next}`, tone: 'success', durationMs: 2500 });
    } catch (error) {
      toast.show({ message: errorMessage(error, 'Le modèle n’a pas pu être enregistré'), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  // Le modèle en service peut ne plus figurer dans la liste (retiré par le
  // fournisseur, ou posé par `.env` sur une clé qui ne le sert pas). Il reste
  // proposé, sans quoi le `select` afficherait silencieusement autre chose que
  // ce qui tourne réellement.
  const options = models.data?.models ?? [];
  const missing = current !== '' && !options.some((m) => m.id === current);

  return (
    <div className="flex min-h-[56px] flex-col gap-2 rounded-card bg-surface px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-[15px] font-medium">{label}</span>
        <span className="text-[13px] text-muted">{hint}</span>
      </div>
      {isAdmin ? (
        <>
          <select
            aria-label={label}
            disabled={saving || settings.isPending}
            value={current}
            onChange={(event) => void save(event.target.value)}
            className="h-touch w-full rounded-xl border border-line bg-ink px-3 text-[16px] focus:border-accent focus:outline-none disabled:text-muted"
          >
            <option value="">Défaut du serveur</option>
            {missing && <option value={current}>{current} (absent de la liste)</option>}
            {options.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </select>
          {models.data?.unavailable && <p className="text-[13px] text-soon">{models.data.unavailable}</p>}
          {models.isError && <p className="text-[13px] text-soon">La liste des modèles n’a pas pu être chargée.</p>}
        </>
      ) : (
        <p className="text-[15px] text-muted">{current === '' ? 'Défaut du serveur' : current}</p>
      )}
    </div>
  );
}
