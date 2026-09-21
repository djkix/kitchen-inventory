import type { CreateLocationInput, LocationNode } from '@kitchen/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScreenHeader } from '../../components/shell/app-shell';
import { Button, IconButton } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/empty-state';
import { PlusIcon, TrashIcon } from '../../components/ui/icons';
import { Sheet } from '../../components/ui/sheet';
import { ListSkeleton } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { api, errorMessage, isApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { flattenLocations, queryKeys, useLocationsQuery } from '../../lib/queries';
import type { MoveContentsResult } from '../../lib/types';
import { LocationEditor, type LocationEditorMode } from './location-editor';

interface DeleteBlocked {
  node: LocationNode;
  itemCount: number;
  childCount: number;
  hasParent: boolean;
}

/** Éditeur de l'arbre des emplacements (EF-06) : créer un enfant, renommer, déplacer, supprimer. */
export function LocationsScreen() {
  const locations = useLocationsQuery();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editor, setEditor] = useState<LocationEditorMode | null>(null);
  const [blocked, setBlocked] = useState<DeleteBlocked | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.locations });

  const submitEditor = async (input: CreateLocationInput) => {
    if (editor?.kind === 'edit') await api.patch<LocationNode>(`/locations/${editor.node.id}`, input);
    else await api.post<LocationNode>('/locations', input);
    await refresh();
    toast.show({ message: editor?.kind === 'edit' ? 'Emplacement modifié' : 'Emplacement créé', tone: 'success', durationMs: 2500 });
  };

  const remove = async (node: LocationNode) => {
    setBusyId(node.id);
    try {
      await api.delete<void>(`/locations/${node.id}`);
      await refresh();
      toast.show({ message: `${node.name} supprimé`, durationMs: 3000 });
    } catch (error) {
      if (isApiError(error, 'conflict')) {
        setBlocked({
          node,
          itemCount: error.detail<number>('itemCount') ?? node.itemCount,
          childCount: error.detail<number>('childCount') ?? node.children.length,
          hasParent: (error.detail<string | null>('parentId') ?? node.parentId) !== null,
        });
      } else {
        toast.show({ message: errorMessage(error), tone: 'danger' });
      }
    } finally {
      setBusyId(null);
    }
  };

  /** Section 17 : refus de suppression → proposer de déplacer le contenu vers le parent. */
  const moveContents = async (node: LocationNode) => {
    setBusyId(node.id);
    try {
      const result = await api.post<MoveContentsResult>(`/locations/${node.id}/move-contents`);
      await refresh();
      setBlocked(null);
      toast.show({ message: `${result.moved} élément${result.moved > 1 ? 's' : ''} déplacé${result.moved > 1 ? 's' : ''} vers le parent. Vous pouvez maintenant supprimer ${node.name}.`, tone: 'success' });
    } catch (error) {
      toast.show({ message: errorMessage(error), tone: 'danger' });
    } finally {
      setBusyId(null);
    }
  };

  const rows = flattenLocations(locations.data ?? []);

  return (
    <>
      <ScreenHeader
        title="Emplacements"
        back="/reglages"
        actions={
          <Button variant="primary" size="sm" icon={<PlusIcon size={18} />} onClick={() => setEditor({ kind: 'create', parentId: null })}>
            Ajouter
          </Button>
        }
      />
      {locations.isPending ? (
        <ListSkeleton rows={4} />
      ) : locations.isError ? (
        <ErrorState message={errorMessage(locations.error)} onRetry={() => void locations.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Aucun emplacement"
          description="Créez vos rangements comme vous les nommez chez vous : « Cuisine › Placard du haut », « Cave ». Le scan demande ensuite où vous rangez."
          action={
            <Button variant="primary" onClick={() => setEditor({ kind: 'create', parentId: null })}>
              Créer le premier emplacement
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-1 px-4">
          {rows.map((node) => (
            <li key={node.id} className={cn('flex min-h-[56px] items-center gap-1 rounded-card bg-surface pr-1', busyId === node.id && 'opacity-60')} style={{ marginLeft: `${node.depth * 16}px` }}>
              <button type="button" onClick={() => setEditor({ kind: 'edit', node })} className="flex min-w-0 flex-1 flex-col justify-center py-2 pl-4 text-left active:bg-raised">
                <span className="truncate text-[15px] font-medium">{node.name}</span>
                <span className="text-[13px] text-muted">
                  {[node.kind, node.temperature === 'chilled' ? 'réfrigéré' : node.temperature === 'frozen' ? 'congelé' : null, `${node.itemCount} article${node.itemCount > 1 ? 's' : ''}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
              <IconButton label={`Ajouter un sous-emplacement dans ${node.name}`} onClick={() => setEditor({ kind: 'create', parentId: node.id })}>
                <PlusIcon size={20} />
              </IconButton>
              <IconButton label={`Supprimer ${node.name}`} className="text-danger" disabled={busyId === node.id} onClick={() => void remove(node)}>
                <TrashIcon size={19} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <LocationEditor mode={editor} tree={locations.data ?? []} onClose={() => setEditor(null)} onSubmit={submitEditor} />

      {blocked && (
        <Sheet open onClose={() => setBlocked(null)} title="Emplacement non vide" description={describeBlocked(blocked)}>
          <div className="flex flex-col gap-2">
            {blocked.hasParent ? (
              <Button variant="primary" size="lg" block loading={busyId === blocked.node.id} onClick={() => void moveContents(blocked.node)}>
                Déplacer le contenu vers le parent
              </Button>
            ) : (
              <p className="rounded-xl bg-surface px-3 py-2 text-[14px] text-muted">Cet emplacement est à la racine : déplacez ou consommez son contenu avant de le supprimer.</p>
            )}
            <Button variant="ghost" size="lg" block onClick={() => setBlocked(null)}>
              Fermer
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function describeBlocked({ node, itemCount, childCount }: DeleteBlocked): string {
  const parts: string[] = [];
  if (itemCount > 0) parts.push(`${itemCount} article${itemCount > 1 ? 's' : ''}`);
  if (childCount > 0) parts.push(`${childCount} sous-emplacement${childCount > 1 ? 's' : ''}`);
  return `${node.name} contient encore ${parts.join(' et ')}. Un emplacement ne se supprime que vide.`;
}
