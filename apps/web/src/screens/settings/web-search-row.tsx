import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage } from '../../lib/api';
import { queryKeys, useSettingsQuery } from '../../lib/queries';
import type { Settings } from '@kitchen/shared';

/**
 * Recherche web réelle pour les suggestions de recettes, réservée aux
 * administrateurs. Le réglage existe parce que le fournisseur facture chaque
 * requête de recherche séparément des jetons — donc hors du plafond mensuel de
 * l'application — et que toutes les clés ne l'autorisent pas : sans
 * interrupteur, une clé qui la refuse ne laisse aucune suggestion du tout.
 */
export function WebSearchRow({ isAdmin }: { isAdmin: boolean }) {
  const settings = useSettingsQuery();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const enabled = settings.data?.suggestionWebSearch ?? true;

  const toggle = async () => {
    const next = !enabled;
    setSaving(true);
    try {
      await api.patch<Settings>('/settings', { suggestionWebSearch: next });
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      toast.show({ message: next ? 'Recherche web activée' : 'Recettes composées sans recherche web', tone: 'success', durationMs: 2500 });
    } catch (error) {
      toast.show({ message: errorMessage(error, 'Le réglage n’a pas pu être enregistré'), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-[56px] items-center gap-3 rounded-card bg-surface px-4 py-2">
      <label htmlFor="web-search" className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-medium">Recherche web des recettes</span>
        <span className="text-[13px] text-muted">
          {enabled ? 'Une partie des recettes vient de pages réelles ; facturée à part par le fournisseur' : 'Toutes les recettes sont composées par le modèle, sans aller sur le web'}
        </span>
      </label>
      <input
        id="web-search"
        type="checkbox"
        role="switch"
        disabled={!isAdmin || saving || settings.isPending}
        checked={enabled}
        onChange={() => void toggle()}
        className="size-6 shrink-0 accent-accent disabled:opacity-60"
      />
    </div>
  );
}
