/**
 * `Location.path` : chaîne d'ancêtres en slugs ASCII, ex. « /cuisine/placard-haut ».
 * Sert aux filtres par sous-arbre sans requête récursive.
 */
export function slugify(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii.length > 0 ? ascii : 'emplacement';
}

export function buildLocationPath(parentPath: string | null, name: string): string {
  return `${parentPath ?? ''}/${slugify(name)}`;
}
