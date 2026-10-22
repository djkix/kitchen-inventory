# Approche IA Gemini : modèle automatique, quotas avant l'appel, pause commune

Date : 2026-10-22. Amende les sections 5, 9, 12, 14, 21 et 22 du cahier des
charges (section 26).

## Intention

Reprendre dans Kitchen l'approche IA éprouvée dans une autre application :
l'IA ne bloque jamais l'utilisateur, les quotas de Google sont respectés
**avant** l'appel, et chaque requête laisse une trace. Les quotas gratuits
(5 requêtes et 250 000 jetons par minute, 20 requêtes par jour, par modèle) se
dépassent vite ; un refus découvert après l'appel coûte un aller-retour et ne
dit pas quand réessayer.

## Décisions

| # | Décision |
| --- | --- |
| D1 | **Modèle automatique.** `GeminiService` lit la liste en direct de Google (`ListModels`, cache 1 h, 1 min après un échec), ne garde que `gemini-<version>-flash` et `-flash-lite` stables (ni Pro, ni aperçu, ni alias, ni instantané), du plus récent au plus ancien, Flash avant Flash-Lite. Les trois menus de Réglages (photo, recettes, repli) disparaissent, avec `SUGGESTION_MODEL` et `FALLBACK_MODEL`. `VISION_MODEL` n'est qu'un repli si la liste est indisponible ; un Pro empêche le démarrage. |
| D2 | **Quotas par modèle, avant l'appel.** Limiteur en mémoire (l'API est un seul processus ; vérifier puis réserver sans `await` entre les deux suffit) : fenêtre glissante de 60 s pour les requêtes et les jetons, compteur du jour du Pacifique. Reprise = plus ancienne entrée + 60 s + 1 s, ou minuit du Pacifique. Limites : réglage du modèle (`Setting.geminiLimits`), sinon `GEMINI_RPM/TPM/RPD`, sinon 5 / 250 000 / 20. |
| D3 | **Bascule.** `GeminiService.call(run)` essaie les modèles dans l'ordre ; un refus de quota (local, ou 429 « PerDay » de Google, qui épuise le modèle jusqu'à minuit du Pacifique) passe au suivant. Écart au guide d'origine : la bascule vaut aussi pour les limites par minute, puisque l'utilisateur attend devant l'écran et que chaque modèle a les siennes. Tous refusés : le refus qui se lève le plus tôt remonte. |
| D4 | **Pause commune.** Un 429 non journalier pose une pause de `retryDelay` (une heure sans indication), un 503 de cinq minutes. Jamais raccourcie, gardée en mémoire et dans `Setting.geminiPause` (survit au redémarrage). |
| D5 | **Aucune file.** Tous les appels de Kitchen sont interactifs : un refus devient un 429 `rate_limited` dont le message porte l'heure de reprise (arrondie à la minute supérieure, jour nommé, jamais « demain ») et `details.retryAt`. L'écran garde son alternative : photo conservée à identifier, saisie manuelle du ticket, réservoir de suggestions avec l'heure de reprise en avis. |
| D6 | **Journal.** Une ligne `GeminiCall` (modèle, statut HTTP, jetons, durée) par `generateContent` réellement envoyé, écrite par le client HTTP que reçoivent les quatre fournisseurs (`GeminiService.http`). Le compteur du jour est rechargé depuis ce journal au démarrage. Le coût reste sur `RecognitionLog`, qui connaît l'usage ; le plafond mensuel est inchangé. Une panne du journal ne casse jamais un appel. |
| D7 | **JSON par la consigne.** `responseMimeType: application/json` sans `responseSchema` (Google refuse en 400 un schéma imbriqué) pour la photo, le ticket et la réécriture ; la forme est décrite dans la consigne, la réponse validée strictement (Zod pour la photo et la réécriture, contrôle ligne à ligne pour le ticket, qui tolère les clôtures ```json et `{"items": […]}`). Les suggestions, avec l'outil de recherche, restaient déjà sans schéma. |
| D8 | **Écran.** Réglages › Reconnaissance, carte « Modèle Gemini (automatique) », administrateurs seulement (`GET /settings/gemini`, `PUT /settings/gemini/limits`) : modèle en cours, modèles dans l'ordre d'emploi avec requêtes du jour et de la minute, jetons de la minute, épuisement avec l'heure de reprise, pause en cours, erreur de la liste, réglage des trois limites. Relue toutes les 30 s. La tuile indicative « Appels Gemini aujourd'hui » disparaît. |

## Hors périmètre

- Rejeu automatique des photos « à identifier » après une pause.
- Graphique de consommation sur 7 ou 30 jours : les tuiles du mois suffisent.
- Limiteur partagé entre plusieurs processus (il faudrait le porter en base).

## Tests

Aucun appel réel : `FakeHttp` rejoue la liste des modèles et les réponses de
`generateContent`, y compris les 429 au format de Google (`QuotaFailure`,
`RetryInfo`). Règles pures (`gemini-time`, `gemini-models`, `gemini-quota`) aux
dates fixes, changements d'heure du Pacifique compris ;
`gemini.e2e-spec.ts` joue la bascule, la pause, le journal, le redémarrage et
l'écran d'administration par la lecture de ticket et la photo.
