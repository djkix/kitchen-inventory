import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GeminiStatus } from '@kitchen/shared';

const state = vi.hoisted(() => ({ data: undefined as unknown, put: vi.fn() }));
vi.mock('../../lib/queries', () => ({
  queryKeys: { geminiStatus: ['settings', 'gemini'] },
  useGeminiStatusQuery: () => ({ isPending: false, isError: false, data: state.data }),
}));
vi.mock('../../lib/api', () => ({ api: { put: state.put }, errorMessage: (_: unknown, f: string) => f }));
vi.mock('../../components/ui/toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

const { GeminiModelsSection } = await import('./gemini-models-section');

const limits = { rpm: 5, tpm: 250_000, rpd: 20 };
const status: GeminiStatus = {
  current: 'gemini-3.5-flash-lite',
  models: [
    { model: 'gemini-3.8-flash', limits, minuteRequests: 0, minuteTokens: 0, dayRequests: 20, blockedUntil: '2026-10-23T07:00:00Z', blockedMessage: 'Quota Gemini du jour atteint (20 requêtes) : reprise vendredi à 09:00.' },
    { model: 'gemini-3.5-flash-lite', limits, minuteRequests: 2, minuteTokens: 12_000, dayRequests: 7, blockedUntil: null, blockedMessage: null },
  ],
  pause: null,
  dayResetsAt: '2026-10-23T07:00:00Z',
};

const renderSection = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GeminiModelsSection />
    </QueryClientProvider>,
  );

describe('GeminiModelsSection', () => {
  it('montre le modèle en cours, la consommation et l’épuisement avec l’heure de reprise', () => {
    state.data = status;
    renderSection();
    expect(screen.getByText('gemini-3.5-flash-lite', { selector: 'span.text-fg' })).toBeTruthy();
    expect(screen.getByText(/7 \/ 20 requêtes aujourd’hui · cette minute : 2 \/ 5, 12\s000 \/ 250\s000 jetons/)).toBeTruthy();
    expect(screen.getByText('Quota Gemini du jour atteint (20 requêtes) : reprise vendredi à 09:00.')).toBeTruthy();
  });

  it('affiche la pause commune', () => {
    state.data = { ...status, current: null, pause: { until: '2026-10-22T12:41:00Z', message: 'Gemini est en pause (service saturé) : reprise à 14:41.' } };
    renderSection();
    expect(screen.getByText('Gemini est en pause (service saturé) : reprise à 14:41.')).toBeTruthy();
    expect(screen.getByText('Aucun modèle disponible pour le moment')).toBeTruthy();
  });

  it('règle les trois limites d’un modèle', async () => {
    state.data = status;
    state.put.mockResolvedValue(status);
    renderSection();
    fireEvent.click(screen.getByText('gemini-3.8-flash'));
    fireEvent.change(screen.getByLabelText('Requêtes / jour'), { target: { value: '250' } });
    fireEvent.click(screen.getByText('Enregistrer les limites'));
    await waitFor(() => expect(state.put).toHaveBeenCalledWith('/settings/gemini/limits', { model: 'gemini-3.8-flash', rpm: 5, tpm: 250_000, rpd: 250 }));
  });
});
