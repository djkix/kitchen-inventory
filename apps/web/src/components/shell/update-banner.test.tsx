import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UpdateBannerView } from './update-banner';

describe('UpdateBannerView', () => {
  it('reste invisible tant qu’aucune version n’attend', () => {
    const { container } = render(<UpdateBannerView visible={false} version="0.6.0" onReload={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('propose le rechargement en nommant la version quand elle est connue', () => {
    render(<UpdateBannerView visible version="0.6.0" onReload={vi.fn()} />);
    expect(screen.getByText(/Nouvelle version disponible \(0\.6\.0\)/)).toBeTruthy();
  });

  it('reste compréhensible quand la version n’est pas encore annoncée', () => {
    render(<UpdateBannerView visible version={null} onReload={vi.fn()} />);
    expect(screen.getByText('Nouvelle version disponible.')).toBeTruthy();
  });

  it('recharge sur appui', () => {
    const onReload = vi.fn();
    render(<UpdateBannerView visible version={null} onReload={onReload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Recharger' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('s’annonce aux lecteurs d’écran sans voler le focus', () => {
    render(<UpdateBannerView visible version={null} onReload={vi.fn()} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
