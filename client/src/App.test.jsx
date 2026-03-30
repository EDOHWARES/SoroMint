import { fireEvent, render, screen } from '@testing-library/react';
import axios from 'axios';
import App from './App';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn()
  }
}));

describe('Responsive token card grid', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.post.mockReset();
  });

  it('shows the empty asset prompt before a wallet is connected', () => {
    render(<App />);

    expect(screen.getByText(/connect your wallet to see your assets/i)).toBeTruthy();
  });

  it('renders minted tokens as cards inside the responsive grid', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          name: 'Aurora Credit',
          symbol: 'AUR',
          contractId: 'CAURORA1234567890',
          decimals: 7
        },
        {
          name: 'Nebula Yield',
          symbol: 'NBY',
          contractId: 'CNBY1234567890ABCDE',
          decimals: 4
        }
      ]
    });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }));

    const grid = await screen.findByRole('list', { name: /token cards/i });

    expect(grid.className).toContain('token-grid');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Aurora Credit')).toBeTruthy();
    expect(screen.getByText('Nebula Yield')).toBeTruthy();
    expect(screen.getAllByText(/contract id/i)).toHaveLength(2);
    expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/tokens\/GB/));
  });
});
