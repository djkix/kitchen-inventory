import type { Paginated, ProductDto } from '@kitchen/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductsQuery } from '../../lib/queries';
import { IngredientsField } from './ingredients-field';

vi.mock('../../lib/queries', () => ({
  useProductsQuery: vi.fn(),
}));

/**
 * Pastilles et autocomplétion (2026-10-19). Le champ était une ligne de texte
 * libre : « poulet tomate » tapé sans virgule faisait **un** ingrédient, et
 * rien à l'écran ne le disait — l'appel au modèle était payé avant de voir
 * « Aucune recette avec ces ingrédients ». Ces tests tiennent les trois
 * promesses : on voit ce qui part, le catalogue propose, la saisie libre reste.
 */

function mockProducts(names: string[]) {
  const items = names.map((name, index) => ({ id: `p${index}`, name }) as ProductDto);
  vi.mocked(useProductsQuery).mockReturnValue({
    data: { items, total: items.length, page: 1, limit: 20 } as Paginated<ProductDto>,
    isSuccess: true,
  } as unknown as ReturnType<typeof useProductsQuery>);
}

function setup(value = '') {
  const onChange = vi.fn();
  render(<IngredientsField value={value} onChange={onChange} />);
  const field = screen.getByRole('combobox', { name: /ingrédients/i });
  return { onChange, field };
}

/** Saisie au clavier : le composant ne lit que la valeur du champ. */
function typeIn(field: HTMLElement, text: string) {
  fireEvent.change(field, { target: { value: text } });
}

/** Valider le terme courant : Entrée, le geste décrit par la demande. */
function pressEnter(field: HTMLElement) {
  fireEvent.keyDown(field, { key: 'Enter' });
}

function chipLabels() {
  return screen.queryAllByRole('listitem').map((item) => item.textContent?.replace(/×$/, '').trim());
}

beforeEach(() => {
  mockProducts([]);
});

describe('IngredientsField, pastilles', () => {
  it('transforme le terme validé par Entrée en pastille, sans rien envoyer encore', () => {
    const { onChange, field } = setup();
    typeIn(field, 'poulet');
    pressEnter(field);

    expect(chipLabels()).toEqual(['poulet']);
    expect((field as HTMLInputElement).value).toBe('');
    // Valider un terme n'est pas lancer la recherche : aucun appel payant.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('découpe sur la virgule tapée : deux pastilles, pas une chaîne ambiguë', () => {
    const { field } = setup();
    typeIn(field, 'poulet,');
    typeIn(field, 'tomate,');

    expect(chipLabels()).toEqual(['poulet', 'tomate']);
  });

  it('garde un terme à plusieurs mots entier : la virgule seule sépare', () => {
    const { field } = setup();
    typeIn(field, 'pommes de terre,');

    expect(chipLabels()).toEqual(['pommes de terre']);
  });

  it('retire une pastille par un bouton qui la nomme', () => {
    const { field } = setup();
    typeIn(field, 'poulet,tomate,');

    fireEvent.click(screen.getByRole('button', { name: 'Retirer poulet' }));
    expect(chipLabels()).toEqual(['tomate']);
  });

  it('retire la dernière pastille au retour arrière sur un champ vide', () => {
    const { field } = setup();
    typeIn(field, 'poulet,tomate,');

    fireEvent.keyDown(field, { key: 'Backspace' });
    expect(chipLabels()).toEqual(['poulet']);
  });

  it('ne retire rien au retour arrière tant que le champ porte du texte', () => {
    const { field } = setup();
    typeIn(field, 'poulet,');
    typeIn(field, 'tom');

    fireEvent.keyDown(field, { key: 'Backspace' });
    expect(chipLabels()).toEqual(['poulet']);
  });

  it('reprend les termes reçus en pastilles, pour ne pas les perdre au remontage', () => {
    setup('poulet, tomate');
    expect(chipLabels()).toEqual(['poulet', 'tomate']);
  });
});

describe('IngredientsField, envoi', () => {
  it('n’oublie pas le terme tapé mais non validé quand on lance la recherche', () => {
    const { onChange, field } = setup();
    typeIn(field, 'poulet,');
    typeIn(field, 'tomate');

    fireEvent.click(screen.getByRole('button', { name: 'Chercher' }));
    expect(onChange).toHaveBeenCalledWith('poulet, tomate');
    expect(chipLabels()).toEqual(['poulet', 'tomate']);
  });

  it('envoie une absence de contrainte quand il ne reste aucun terme', () => {
    const { onChange } = setup('poulet');
    fireEvent.click(screen.getByRole('button', { name: 'Retirer poulet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chercher' }));

    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('IngredientsField, bornes du schéma partagé', () => {
  it('refuse une sixième pastille, dit pourquoi, et ne l’ajoute pas', () => {
    const { onChange, field } = setup();
    typeIn(field, 'a,b,c,d,e,');
    typeIn(field, 'f');
    pressEnter(field);

    expect(screen.getByRole('alert').textContent).toMatch(/5 ingrédients au maximum/i);
    expect(chipLabels()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuse un terme de plus de trente caractères', () => {
    const { field } = setup();
    typeIn(field, 'x'.repeat(31));
    pressEnter(field);

    expect(screen.getByRole('alert').textContent).toMatch(/30 caractères au maximum/i);
    expect(chipLabels()).toEqual([]);
  });
});

describe('IngredientsField, autocomplétion depuis le catalogue', () => {
  it('propose les produits du catalogue et pose le libellé exact en pastille', () => {
    mockProducts(['Poulet fermier', 'Poulet rôti']);
    const { field } = setup();
    typeIn(field, 'pou');

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual(['Poulet fermier', 'Poulet rôti']);

    fireEvent.click(within(listbox).getByRole('option', { name: 'Poulet fermier' }));
    expect(chipLabels()).toEqual(['Poulet fermier']);
    expect((field as HTMLInputElement).value).toBe('');
  });

  it('laisse passer un terme absent du catalogue : « reste de merguez »', () => {
    mockProducts(['Poulet fermier']);
    const { field } = setup();
    typeIn(field, 'reste de merguez');
    pressEnter(field);

    expect(chipLabels()).toEqual(['reste de merguez']);
  });

  it('ne propose pas un produit déjà en pastille', () => {
    mockProducts(['Poulet fermier', 'Poulet rôti']);
    const { field } = setup('Poulet fermier');
    typeIn(field, 'pou');

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Poulet rôti']);
  });
});

describe('IngredientsField, motif combobox', () => {
  it('annonce l’ouverture de la liste et l’option survolée au clavier', () => {
    mockProducts(['Poulet fermier', 'Poulet rôti']);
    const { field } = setup();
    expect(field.getAttribute('aria-expanded')).toBe('false');

    typeIn(field, 'pou');
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(field.getAttribute('aria-activedescendant')).toBeNull();

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    const first = screen.getAllByRole('option')[0];
    expect(field.getAttribute('aria-activedescendant')).toBe(first?.id);
    expect(first?.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(field.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1]?.id);
  });

  it('valide l’option survolée par Entrée plutôt que le texte tapé', () => {
    mockProducts(['Poulet fermier']);
    const { field } = setup();
    typeIn(field, 'pou');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    pressEnter(field);

    expect(chipLabels()).toEqual(['Poulet fermier']);
  });

  it('ferme la liste sur Échap sans vider la saisie', () => {
    mockProducts(['Poulet fermier']);
    const { field } = setup();
    typeIn(field, 'pou');

    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field.getAttribute('aria-expanded')).toBe('false');
    expect((field as HTMLInputElement).value).toBe('pou');
  });
});
