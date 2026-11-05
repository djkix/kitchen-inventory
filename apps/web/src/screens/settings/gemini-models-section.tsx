import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage } from '../../lib/api';
import { queryKeys, useGeminiStatusQuery } from '../../lib/queries';
import type { GeminiStatus } from '@kitchen/shared';

const NUMBER = new Intl.NumberFormat('fr-FR');
type ModelStatus = GeminiStatus['models'][number];

/**
 * Modèles Gemini, choisis par l'application (approche de Ma Cave, 2026-10-22) :
 * la liste vient de Google, dans l'ordre d'emploi ; le premier qui n'est pas
 * bloqué sert, et un quota atteint fait basculer sur le suivant. Réservé aux
 * administrateurs, qui règlent ici les limites de chaque modèle.
 */
export function GeminiModelsSection() {
  const status = useGeminiStatusQuery();
  const [editing, setEditing] = useState<string | null>(null);

  if (status.isPending) return null;
  if (status.isError) return <p className="text-[13px] text-soon">L’état des modèles Gemini n’a pas pu être chargé.</p>;
  const s = status.data;

  return (
    <div className="flex flex-col gap-2 rounded-card bg-surface px-4 py-3">
      <div className="flex flex-col">
        <span className="text-[15px] font-medium">Modèle Gemini (automatique)</span>
        <span className="text-[13px] text-muted">
          {s.current ? (
            <>
              En cours : <span className="text-fg">{s.current}</span>
            </>
          ) : (
            'Aucun modèle disponible pour le moment'
          )}
        </span>
      </div>
      {s.pause && <p className="rounded-xl bg-soon-deep px-3 py-2 text-[14px] text-soon">{s.pause.message}</p>}
      {s.error && <p className="text-[13px] text-soon">{s.error}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {s.models.map((m) => (
          <li key={m.model} className="flex flex-col gap-1 py-2">
            <button
              type="button"
              aria-expanded={editing === m.model}
              onClick={() => setEditing(editing === m.model ? null : m.model)}
              className="flex min-h-touch flex-col items-start text-left"
            >
              <span className="text-[15px]">{m.model}</span>
              <span className="tnum text-[13px] text-muted">
                {m.dayRequests} / {m.limits.rpd} requêtes aujourd’hui · cette minute : {m.minuteRequests} / {m.limits.rpm}, {NUMBER.format(m.minuteTokens)} /{' '}
                {NUMBER.format(m.limits.tpm)} jetons
              </span>
              {m.blockedMessage && <span className="text-[13px] text-soon">{m.blockedMessage}</span>}
            </button>
            {editing === m.model && <LimitsForm model={m} onDone={() => setEditing(null)} />}
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-faint">Quotas du jour remis à zéro à minuit, heure du Pacifique (celle de Google).</p>
    </div>
  );
}

function LimitsForm({ model, onDone }: { model: ModelStatus; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState(model.limits);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await api.put<GeminiStatus>('/settings/gemini/limits', { model: model.model, ...values });
      queryClient.setQueryData(queryKeys.geminiStatus, next);
      toast.show({ message: `Limites de ${model.model} enregistrées`, tone: 'success', durationMs: 2500 });
      onDone();
    } catch (error) {
      toast.show({ message: errorMessage(error, 'Les limites n’ont pas pu être enregistrées'), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof ModelStatus['limits'], label: string) => (
    <label className="flex flex-col gap-1 text-[13px] text-muted">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={1}
        required
        value={values[key]}
        onChange={(e) => setValues({ ...values, [key]: Number(e.target.value) })}
        className="h-touch w-full rounded-xl border border-line bg-ink px-3 text-[16px] text-fg focus:border-accent focus:outline-none"
      />
    </label>
  );

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {field('rpm', 'Requêtes / min')}
        {field('tpm', 'Jetons / min')}
        {field('rpd', 'Requêtes / jour')}
      </div>
      <Button type="submit" variant="primary" loading={saving} block>
        Enregistrer les limites
      </Button>
    </form>
  );
}
