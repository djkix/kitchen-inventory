import { Inject, Injectable } from '@nestjs/common';
import type { AvailableModel, AvailableModels } from '@kitchen/shared';
import { APP_CONFIG, type AppConfig } from '../common/config.js';
import { HTTP_CLIENT, type HttpClient } from '../common/http-client.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/**
 * Durée de validité du cache. La liste des modèles d'un fournisseur bouge au
 * rythme des semaines, pas des minutes : dix minutes suffisent à ne pas
 * rappeler l'API à chaque ouverture des réglages, sans figer une nouveauté
 * jusqu'au redémarrage.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

interface GeminiModelRow {
  name?: string;
  supportedGenerationMethods?: string[];
}

/**
 * Liste des modèles que la clé configurée sert réellement (`ListModels`).
 *
 * Pourquoi cette route existe : le 2026-10-05, les suggestions appelaient
 * `gemini-3.5-pro`, un nom plausible mais absent de l'API. Six appels, six 404,
 * et un écran vide sans explication — qu'aucun test ne pouvait voir, puisque
 * tous parlent à une doublure qui répond quel que soit le nom demandé. Proposer
 * le choix depuis la liste réelle ferme cette classe d'erreur à la source.
 *
 * L'appel est gratuit et ne consomme pas le quota de génération : il peut donc
 * échouer sans conséquence, et son échec n'est jamais une erreur de la route —
 * il est rendu dans `unavailable`, à afficher tel quel.
 */
/**
 * Familles écartées du choix : elles répondent bien à `generateContent` mais ne
 * savent pas lire une étiquette ni rédiger une recette, ou ne sont pas faites
 * pour servir en production.
 */
const SPECIALISED = /embedding|aqa|transcribe|live|tts|audio|image|imagen|veo|learnlm|gemma|thinking|dialog|robotics|computer-use/;

/** Instantanés datés ou numérotés (`-001`, `-2026-03-25`) : du bruit à côté de l'alias stable. */
const PINNED_SNAPSHOT = /-\d{3}$|-\d{4}-\d{2}-\d{2}$|-\d{2}-\d{2}$/;

/**
 * Un modèle de la ligne courante : `gemini-…`, ni aperçu, ni expérimental, ni
 * instantané daté, ni famille spécialisée. Volontairement permissif sur le
 * numéro de version, pour qu'une nouvelle génération apparaisse d'elle-même
 * sans modification du code.
 */
export function isMainstreamGeminiModel(id: string): boolean {
  if (!id.startsWith('gemini-')) return false;
  if (id.includes('preview') || id.includes('-exp')) return false;
  if (SPECIALISED.test(id)) return false;
  return !PINNED_SNAPSHOT.test(id);
}

@Injectable()
export class AvailableModelsService {
  private cache: { at: number; value: AvailableModels } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(HTTP_CLIENT) private readonly httpClient: HttpClient,
  ) {}

  async list(): Promise<AvailableModels> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.value;
    const value = await this.fetch();
    this.cache = { at: Date.now(), value };
    return value;
  }

  private async fetch(): Promise<AvailableModels> {
    if (this.config.VISION_PROVIDER !== 'gemini') {
      return { models: [], unavailable: `La liste des modèles n’est connue que pour Gemini (fournisseur configuré : ${this.config.VISION_PROVIDER}).` };
    }
    if (!this.config.VISION_API_KEY) {
      return { models: [], unavailable: 'Aucune clé API n’est configurée : renseignez VISION_API_KEY.' };
    }

    const base = (this.config.VISION_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    let response: Response;
    try {
      response = await this.httpClient(`${base}/v1beta/models?pageSize=200`, {
        // La clé passe en en-tête, jamais dans l'URL : elle n'apparaît ainsi dans aucun journal.
        headers: { 'x-goog-api-key': this.config.VISION_API_KEY },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { models: [], unavailable: 'Le fournisseur n’a pas répondu ; la liste des modèles est momentanément indisponible.' };
    }
    if (!response.ok) {
      return { models: [], unavailable: `Le fournisseur a refusé la demande de liste (${response.status}).` };
    }

    const body = (await response.json()) as { models?: GeminiModelRow[] };
    const generative: AvailableModel[] = (body.models ?? [])
      // Seuls les modèles capables de générer du texte nous intéressent : la clé
      // sert aussi des modèles d'embedding ou de transcription, qui n'ont rien à
      // faire dans un choix de reconnaissance ou de recettes.
      .filter((row) => row.supportedGenerationMethods?.includes('generateContent'))
      .map((row) => ({ id: (row.name ?? '').replace(/^models\//, '') }))
      .filter((row) => row.id !== '')
      .sort((a, b) => a.id.localeCompare(b.id));

    // La clé déclare une soixantaine de modèles : versions datées, aperçus,
    // familles spécialisées (parole, image, vidéo). Dérouler tout cela pour
    // choisir entre deux ou trois modèles utilisables est inutilisable au
    // téléphone. On ne garde donc que la ligne courante de Gemini. Si le filtre
    // ne laisse rien — famille renommée, convention changée — la liste complète
    // reprend la main : mieux vaut une liste longue qu'un écran vide.
    const mainstream = generative.filter((m) => isMainstreamGeminiModel(m.id));
    const models = mainstream.length > 0 ? mainstream : generative;

    return models.length > 0 ? { models } : { models: [], unavailable: 'Le fournisseur n’a déclaré aucun modèle de génération.' };
  }
}
