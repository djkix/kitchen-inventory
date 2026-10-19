import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from './sheet';

/**
 * Le geste « page précédente » (glissement vers la gauche sur un téléphone,
 * bouton Retour d'Android) doit **fermer le tiroir**, pas quitter l'écran.
 *
 * Franck l'a rencontré le 2026-10-19 sur le tiroir d'une suggestion : « quand
 * je swipe vers la gauche, au lieu d'avoir un retour aux suggestions, je
 * bascule sur Mes recettes ». Aucun code de l'application n'écoutait ce
 * glissement — c'est le navigateur qui revenait à l'entrée d'historique
 * précédente, puisque l'ouverture d'un tiroir n'en ajoutait aucune.
 *
 * Le correctif vit dans ce composant partagé, utilisé par les dix-sept
 * tiroirs de l'application : tous avaient le même défaut.
 */
/**
 * Démonte avant de rendre la main, puis laisse retomber le retour arrière que
 * le démontage déclenche : `history.back()` est asynchrone, et une dépile en
 * attente fausserait le test suivant.
 */
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
});

function renderSheet({ open = true, ...props }: Partial<Parameters<typeof Sheet>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(
    <Sheet onClose={onClose} title="Tiroir" {...props} open={open}>
      <p>contenu</p>
    </Sheet>,
  );
  const setOpen = (next: boolean) =>
    view.rerender(
      <Sheet onClose={onClose} title="Tiroir" {...props} open={next}>
        <p>contenu</p>
      </Sheet>,
    );
  return { onClose, setOpen };
}

/** Marque posée par le tiroir sur son entrée d'historique. */
const marker = () => (window.history.state as { kitchenSheet?: string } | null)?.kitchenSheet;

describe('Sheet et le geste « page précédente »', () => {
  it('empile une entrée d’historique à l’ouverture', () => {
    const { setOpen } = renderSheet({ open: false });
    expect(marker()).toBeUndefined();

    setOpen(true);

    expect(typeof marker()).toBe('string');
  });

  it('ferme le tiroir sur un retour arrière, au lieu de quitter l’écran', async () => {
    const { onClose } = renderSheet();

    window.history.back();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // Un enregistrement en cours ne doit pas être interrompu : le tiroir est
  // verrouillé, l'entrée est remise en place pour que le piège tienne encore.
  it('ignore le retour arrière pendant un envoi (locked)', async () => {
    const { onClose } = renderSheet({ locked: true });
    const avant = marker();

    // Attend que le `popstate` ait réellement été traité : `history.back()`
    // est asynchrone, et vérifier trop tôt lirait l'état d'avant le retour —
    // un test qui passerait même sans le verrou.
    const traite = new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }));
    window.history.back();
    await traite;

    expect(onClose).not.toHaveBeenCalled();
    // L'entrée est remise en place : le piège tient pour le retour suivant.
    await waitFor(() => expect(marker()).toBe(avant));
  });

  /**
   * Piège connu du motif : fermer par la croix laisse sinon une entrée
   * « fantôme » derrière, et il faut appuyer deux fois sur Retour pour quitter
   * réellement l'écran.
   */
  it('retire son entrée quand on ferme autrement (croix, Échap, Annuler)', async () => {
    const { setOpen } = renderSheet();
    expect(typeof marker()).toBe('string');

    setOpen(false);

    await waitFor(() => expect(marker()).toBeUndefined());
  });

  // Deux tiroirs ouverts l'un sur l'autre : un retour ne ferme que celui du
  // dessus, jamais les deux d'un coup.
  it('ne ferme que le tiroir du dessus quand deux sont ouverts', async () => {
    const closeBas = vi.fn();
    const closeHaut = vi.fn();
    render(
      <>
        <Sheet open onClose={closeBas} title="Bas">
          <p>bas</p>
        </Sheet>
        <Sheet open onClose={closeHaut} title="Haut">
          <p>haut</p>
        </Sheet>
      </>,
    );

    window.history.back();

    await waitFor(() => expect(closeHaut).toHaveBeenCalled());
    expect(closeBas).not.toHaveBeenCalled();
  });

  /**
   * Une navigation volontaire (conserver une suggestion mène à la fiche de la
   * recette) pousse sa propre entrée : la fermeture du tiroir qui suit ne doit
   * pas la dépiler, sinon le passage à la fiche serait mangé.
   */
  it('ne dépile rien si une navigation a déjà remplacé son entrée', async () => {
    const { setOpen } = renderSheet();
    window.history.pushState({ page: 'recette' }, '');

    setOpen(false);

    // Laisse passer un éventuel retour arrière (asynchrone en jsdom).
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((window.history.state as { page?: string }).page).toBe('recette');
  });

  it('ferme toujours par la croix et par Échap', () => {
    const { onClose } = renderSheet();

    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
