# Demande parlée : Gemini écoute, comprend, et propose

**Date** : 2026-10-21
**Demande de djkix** : « il me faut une analyse de la transcription que
j'enregistre. Par ex : "il me reste du poulet, et un peu de sauce tomate, je
veux faire un plat italien, qu'est-ce que tu me proposes". Gemini va analyser
ce que j'ai (identification des ingrédients fournis via le vocal, matching
avec l'inventaire, et proposition de recette en combinant les 2). »
**Exigences touchées** : EF-25, EF-26 (section 12), section 10 (données).

## Ce qui est visé, et ce qui ne l'est pas

djkix fait déjà cela dans l'application Gemini. Ce qui lui manque, c'est le
**croisement avec son stock réel** — la seule chose que son téléphone ne sait
pas et que son inventaire sait.

Une première version, écrite puis **retirée avant publication** le même jour,
faisait transcrire la parole par le navigateur et en tirait des pastilles
d'ingrédients. Elle répondait à la lettre de la demande initiale et à côté de
son intention : une phrase entière n'est pas une liste de courses, et la
découper en termes perd « je veux un plat italien ».

## Décisions

**D1 — Gemini entend l'audio.** Choix de djkix entre deux options. Le
navigateur enregistre, le serveur transmet, le modèle transcrit et comprend en
un seul appel. Motifs : une phrase longue passe mieux qu'avec le moteur du
téléphone, rien ne dépend du navigateur, et sur Chrome la confidentialité est
de toute façon identique — la reconnaissance vocale du navigateur y envoie
déjà l'audio à Google. Contrepartie assumée : sur Safari, la transcription se
serait faite sur l'appareil ; elle part désormais au réseau dans tous les cas.

**D2 — Un seul appel, pas d'étape de confirmation.** Choix de djkix. Le
modèle rend sa lecture **et** les recettes dans la même réponse. Contrepartie
assumée : une erreur d'écoute ne se découvre qu'en lisant des recettes à côté
de la plaque. La lecture comprise est donc **affichée avec les résultats**,
pour que l'erreur soit visible sans être coûteuse.

**D3 — Un parcours à part.** Choix de djkix contre une intégration au champ
à pastilles. La demande parlée a son écran : on parle, on obtient des
recettes. Le champ d'ingrédients tapé reste ce qu'il est, inchangé. Deux
chemins distincts, pas deux façons de remplir le même champ.

**D4 — Ce que le modèle a compris revient avec les recettes.** Il rend les
ingrédients qu'il a entendus et l'orientation qu'il a déduite. Les ingrédients
entendus sont traités comme **déclarés** : jamais annoncés comme manquants,
exactement comme ceux tapés à la main (D5 de la spec du 2026-10-19). La
couverture reste calculée sur le stock réel.

**D5 — Une demande parlée appelle toujours le modèle.** Le réservoir n'est pas
lu d'abord : une phrase est unique, il n'y a rien à retrouver. Le geste est
délibéré et rare, il consomme un appel du quota journalier comme une relance.
Les recettes rendues **entrent au réservoir** comme les autres (D1 de la spec
du 2026-10-15) : rien de payé n'est jeté.

**D6 — L'audio n'est jamais conservé.** Ni sur disque, ni en base, ni dans le
journal des appels. `RecognitionLog.rawResult` garde la réponse du modèle, pas
l'enregistrement. L'audio traverse le serveur et disparaît.

**D7 — L'audio est facturé plus cher que le texte, et le plafond doit le
savoir.** `PRICES_USD_PER_MTOK` ne porte aujourd'hui qu'un tarif d'entrée,
appliqué à tous les jetons. L'entrée audio coûte davantage — pour Flash-Lite,
l'ordre de grandeur est le triple. Sans distinction, le plafond mensuel
sous-compte **en silence**, exactement comme il le faisait pour les requêtes
de recherche web avant la 0.12.0. La table doit donc porter un tarif audio, et
le calcul s'appuyer sur la ventilation par modalité que l'API rend quand elle
est présente. **Quand elle est absente, on facture tout au tarif audio** :
mieux vaut surestimer un plafond de protection que le laisser mentir.

**D8 — L'enregistrement est borné.** Durée maximale, taille maximale, et refus
explicite au-delà. Un enregistrement sans borne est une facture sans borne, et
une requête qu'un reverse proxy coupera de toute façon.

**D9 — Le micro refusé se dit.** Autorisation refusée, micro absent,
enregistrement vide, modèle qui n'a rien compris : chacun a son message en
français. Jamais un bouton qui ne réagit pas.

## Limites assumées

- **La parole part au réseau**, vers l'API Gemini. C'est le prix de D1, et
  c'est contraire à l'esprit de la section 10 du cahier des charges, qui veut
  qu'aucune donnée ne parte vers un tiers. djkix l'a tranché en connaissance
  de cause : il fait déjà exactement cela dans l'application Gemini.
- **Un contresens coûte un appel.** C'est le prix de D2.
- **Le coût réel reste à mesurer.** Les tarifs audio sont documentés par
  Google mais la conversion secondes → jetons ne l'est pas clairement ; la
  première mesure se fera sur un appel réel, lu dans le journal.
