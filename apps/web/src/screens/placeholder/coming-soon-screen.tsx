import { ScreenHeader } from '../../components/shell/app-shell';
import { EmptyState } from '../../components/ui/empty-state';
import { CartIcon, RecipesIcon } from '../../components/ui/icons';

interface Props {
  title: 'Recettes' | 'Courses';
}

/** Onglets du lot 2 : présents dans la navigation, contenu annoncé (décision 8). */
export function ComingSoonScreen({ title }: Props) {
  const Icon = title === 'Recettes' ? RecipesIcon : CartIcon;
  const description =
    title === 'Recettes'
      ? 'Les suggestions de recettes à partir du stock réel arrivent au lot 2, après quelques semaines d’inventaire. En attendant, remplissez le stock : c’est lui qui nourrira les recettes.'
      : 'La liste de courses alimentée par les seuils et les recettes arrive au lot 2. Les seuils par produit se règlent déjà dans la fiche produit.';
  return (
    <>
      <ScreenHeader title={title} />
      <EmptyState icon={<Icon size={40} />} title="Disponible au lot 2" description={description} />
    </>
  );
}
