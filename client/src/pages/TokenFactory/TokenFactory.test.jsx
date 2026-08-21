/**
 * @file TokenFactory.test.jsx
 * @description Unit tests for the Token Factory dashboard page.
 *
 * Coverage:
 *   1. Unauthenticated state — wallet connect nudge, disabled form
 *   2. Authenticated state — metrics load, form renders, deploy flow
 *   3. Deploy form validation — required fields, symbol format, decimals range
 *   4. Recent deployments table — renders tokens, copy affordance
 *   5. Error handling — API failure shows banner, toast
 *   6. Refresh button — triggers reload
 *   7. Accessibility — ARIA labels, role attributes
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import React, { Suspense } from 'react';

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Mock the factory service so tests never hit the network
vi.mock('../../services/factoryService', () => ({
  getTokensByOwner: vi.fn(),
  deployToken: vi.fn(),
  getFactoryMetrics: vi.fn(),
  default: {
    getTokensByOwner: vi.fn(),
    deployToken: vi.fn(),
    getFactoryMetrics: vi.fn(),
  },
}));

// Mock the Zustand wallet store — default: no wallet connected
vi.mock('../../store', () => ({
  useWalletStore: vi.fn(),
  useTokenStore: vi.fn(() => ({ tokens: [], isLoading: false, fetchTokens: vi.fn() })),
  useUIStore: vi.fn(() => ({ theme: 'dark', initTheme: vi.fn(), setTheme: vi.fn() })),
}));

// react-toastify — capture calls without rendering the container
vi.mock('react-toastify', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  ToastContainer: () => null,
}));

// react-helmet-async — skip head management in tests
vi.mock('react-helmet-async', () => ({
  HelmetProvider: ({ children }) => children,
  Helmet: () => null,
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import TokenFactory from './TokenFactory';
import { getFactoryMetrics, deployToken } from '../../services/factoryService';
import { useWalletStore } from '../../store';
import { toast } from 'react-toastify';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const MOCK_ADDRESS = 'GBMOCK1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MOCK_TOKEN = {
  _id: 'tok_001',
  name: 'Stellar Gold',
  symbol: 'SGLD',
  contractId: 'CSGLD1234567890ABCDEF',
  decimals: 7,
  createdAt: '2026-06-15T10:00:00.000Z',
};

/** Render with a Suspense boundary (TokenFactory is not lazy here, but
 *  sub-components may suspend in future). */
const renderFactory = (props = {}) =>
  render(
    <Suspense fallback={<div>Loading…</div>}>
      <TokenFactory authToken="mock-jwt" {...props} />
    </Suspense>
  );

/** Wire the wallet store mock to return a connected wallet. */
const withConnectedWallet = () => {
  useWalletStore.mockReturnValue({ address: MOCK_ADDRESS });
};

/** Wire the wallet store mock to return no wallet. */
const withDisconnectedWallet = () => {
  useWalletStore.mockReturnValue({ address: null });
};

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  withDisconnectedWallet();
  getFactoryMetrics.mockResolvedValue({ totalDeployed: 0, recentTokens: [] });
  deployToken.mockResolvedValue(MOCK_TOKEN);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('TokenFactory — page structure', () => {
  it('renders the page heading', async () => {
    renderFactory();
    expect(
      await screen.findByRole('heading', { level: 1, name: /token factory/i }),
    ).toBeInTheDocument();
  });

  it('renders the page subtitle', async () => {
    renderFactory();
    expect(
      await screen.findByText(/deploy and manage soroban token contracts/i),
    ).toBeInTheDocument();
  });

  it('renders the contract version pill', async () => {
    renderFactory();
    expect(await screen.findByText(/contract v2\.0\.0/i)).toBeInTheDocument();
  });

  it('renders the Live status pill', async () => {
    renderFactory();
    expect(await screen.findByText(/live/i)).toBeInTheDocument();
  });

  it('renders the four metric cards', async () => {
    renderFactory();
    await screen.findByRole('heading', { level: 1, name: /token factory/i });
    const metricsRegion = screen.getByLabelText(/factory metrics/i);
    // four metric cards inside the region
    expect(within(metricsRegion).getAllByRole('generic').length).toBeGreaterThanOrEqual(4);
  });
});

describe('TokenFactory — unauthenticated state', () => {
  beforeEach(() => {
    withDisconnectedWallet();
  });

  it('shows the wallet connect nudge banner', async () => {
    renderFactory();
    expect(
      await screen.findByText(/connect your wallet to deploy and manage tokens/i),
    ).toBeInTheDocument();
  });

  it('shows the wallet prompt inside the deploy form panel', async () => {
    renderFactory();
    // The DeployForm renders the same wallet prompt string when no address
    const prompts = await screen.findAllByText(
      /connect your wallet to deploy and manage tokens/i,
    );
    expect(prompts.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT render the deploy form fields when wallet is disconnected', async () => {
    renderFactory();
    await screen.findByText(/connect your wallet to deploy and manage tokens/i);
    expect(screen.queryByLabelText(/token name/i)).not.toBeInTheDocument();
  });

  it('shows the empty state in the recent deployments panel', async () => {
    renderFactory();
    expect(
      await screen.findByText(/no tokens deployed yet/i),
    ).toBeInTheDocument();
  });
});

describe('TokenFactory — authenticated state', () => {
  beforeEach(() => {
    withConnectedWallet();
    getFactoryMetrics.mockResolvedValue({
      totalDeployed: 3,
      recentTokens: [MOCK_TOKEN],
    });
  });

  it('loads factory metrics on mount and shows totalDeployed', async () => {
    renderFactory();
    await waitFor(() => {
      expect(getFactoryMetrics).toHaveBeenCalledWith(MOCK_ADDRESS, 'mock-jwt');
    });
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('renders the deploy form fields', async () => {
    renderFactory();
    expect(await screen.findByLabelText(/token name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/symbol/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/decimals/i)).toBeInTheDocument();
  });

  it('renders recent tokens in the deployments table', async () => {
    renderFactory();
    expect(await screen.findByText('Stellar Gold')).toBeInTheDocument();
    expect(screen.getByText('SGLD')).toBeInTheDocument();
  });

  it('renders truncated contract ID in the table', async () => {
    renderFactory();
    // CSGLD1234567890ABCDEF → truncated to CSGLD123…ABCDEF
    expect(await screen.findByTitle('CSGLD1234567890ABCDEF')).toBeInTheDocument();
  });
});

describe('TokenFactory — deploy form validation', () => {
  beforeEach(() => {
    withConnectedWallet();
  });

  it('shows a required error when name is empty on submit', async () => {
    renderFactory();
    const button = await screen.findByRole('button', { name: /deploy token/i });
    fireEvent.click(button);
    expect(await screen.findByText(/token name is required/i)).toBeInTheDocument();
  });

  it('shows a required error when symbol is empty on submit', async () => {
    renderFactory();
    const nameInput = await screen.findByLabelText(/token name/i);
    fireEvent.change(nameInput, { target: { value: 'Test Token' } });
    fireEvent.click(screen.getByRole('button', { name: /deploy token/i }));
    expect(await screen.findByText(/symbol is required/i)).toBeInTheDocument();
  });

  it('shows a format error when symbol contains invalid characters', async () => {
    renderFactory();
    const nameInput = await screen.findByLabelText(/token name/i);
    const symbolInput = screen.getByLabelText(/symbol/i);
    fireEvent.change(nameInput, { target: { value: 'Test Token' } });
    fireEvent.change(symbolInput, { target: { value: 'BAD SYMBOL!' } });
    fireEvent.click(screen.getByRole('button', { name: /deploy token/i }));
    expect(
      await screen.findByText(/symbol must be 1.12 alphanumeric characters/i),
    ).toBeInTheDocument();
  });

  it('shows a range error when decimals is negative', async () => {
    renderFactory();
    const nameInput = await screen.findByLabelText(/token name/i);
    const symbolInput = screen.getByLabelText(/symbol/i);
    const decimalsInput = screen.getByLabelText(/decimals/i);
    fireEvent.change(nameInput, { target: { value: 'Test Token' } });
    fireEvent.change(symbolInput, { target: { value: 'TST' } });
    fireEvent.change(decimalsInput, { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: /deploy token/i }));
    expect(
      await screen.findByText(/decimals must be an integer between 0 and 18/i),
    ).toBeInTheDocument();
  });

  it('does NOT call deployToken when validation fails', async () => {
    renderFactory();
    await screen.findByRole('button', { name: /deploy token/i });
    fireEvent.click(screen.getByRole('button', { name: /deploy token/i }));
    await screen.findByText(/token name is required/i);
    expect(deployToken).not.toHaveBeenCalled();
  });
});

describe('TokenFactory — successful deployment', () => {
  beforeEach(() => {
    withConnectedWallet();
    getFactoryMetrics.mockResolvedValue({ totalDeployed: 0, recentTokens: [] });
    deployToken.mockResolvedValue(MOCK_TOKEN);
  });

  it('calls deployToken with correct payload on valid submit', async () => {
    renderFactory();
    const nameInput = await screen.findByLabelText(/token name/i);
    const symbolInput = screen.getByLabelText(/symbol/i);
    const decimalsInput = screen.getByLabelText(/decimals/i);

    fireEvent.change(nameInput, { target: { value: 'Stellar Gold' } });
    fireEvent.change(symbolInput, { target: { value: 'SGLD' } });
    fireEvent.change(decimalsInput, { target: { value: '7' } });

    fireEvent.click(screen.getByRole('button', { name: /deploy token/i }));

    await waitFor(() => {
      expect(deployToken).toHaveBeenCalledTimes(1);
    });

    const [payload, jwt] = deployToken.mock.calls[0];
    expect(payload.name).toBe('Stellar Gold');
    expect(payload.symbol).toBe('SGLD');
    expect(payload.decimals).toBe(7);
    expect(payload.ownerPublicKey).toBe(MOCK_ADDRESS);
    expect(typeof payload.contractId).toBe('string');
    expect(typeof payload.salt).toBe('string');
    expect(jwt).toBe('mock-jwt');
  });

  it('shows a success toast on deployment', async () => {
    renderFactory();
    const nameInput = await screen.findByLabelText(/token name/i);
    const symbolInput = screen.getByLabelText(/symbol/i);

    fireEvent.change(nameInput, { target: { value: 'Stellar Gold' } });
    fireEvent.change(symbolInput, { target: { value: 'SGLD' } });
    fireEvent.click(screen.getByRole('button', { name: /deploy token/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringMatching(/deployed successfully/i),
      );
    });
  });

  it('resets the form fields after successful deployment', async () => {
    renderFactory();
    const nameInput = await screen.findByLabelText(/token name/i);
    const symbolInput = screen.getByLabelText(/symbol/i);

    fireEvent.change(nameInput, { target: { value: 'Stellar Gold' } });
    fireEvent.change(symbolInput, { target: { value: 'SGLD' } });
    fireEvent.click(screen.getByRole('button', { name: /deploy token/i }));

    await waitFor(() => expect(deployToken).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      expect(screen.getByLabelText(/token name/i)).toHaveValue('');
    });
  });
});

describe('TokenFactory — deploy error handling', () => {
  beforeEach(() => {
    withConnectedWallet();
    deployToken.mockRejectedValue(new Error('Soroban RPC timeout'));
  });

  it('shows an error toast when deployToken throws', async () => {
    renderFactory();
    const nameInput = await screen.findByLabelText(/token name/i);
    const symbolInput = screen.getByLabelText(/symbol/i);

    fireEvent.change(nameInput, { target: { value: 'Fail Token' } });
    fireEvent.change(symbolInput, { target: { value: 'FAIL' } });
    fireEvent.click(screen.getByRole('button', { name: /deploy token/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/soroban rpc timeout/i),
      );
    });
  });

  it('re-enables the deploy button after a failed deployment', async () => {
    renderFactory();
    const nameInput = await screen.findByLabelText(/token name/i);
    const symbolInput = screen.getByLabelText(/symbol/i);

    fireEvent.change(nameInput, { target: { value: 'Fail Token' } });
    fireEvent.change(symbolInput, { target: { value: 'FAIL' } });
    fireEvent.click(screen.getByRole('button', { name: /deploy token/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    expect(
      screen.getByRole('button', { name: /deploy token/i }),
    ).not.toBeDisabled();
  });
});

describe('TokenFactory — metrics API error', () => {
  beforeEach(() => {
    withConnectedWallet();
    getFactoryMetrics.mockRejectedValue(new Error('Connection refused'));
  });

  it('shows the error banner when metrics fail to load', async () => {
    renderFactory();
    expect(
      await screen.findByText(/failed to load factory metrics/i),
    ).toBeInTheDocument();
  });

  it('shows an error toast when metrics fail to load', async () => {
    renderFactory();
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/failed to load factory metrics/i),
      );
    });
  });
});

describe('TokenFactory — refresh', () => {
  beforeEach(() => {
    withConnectedWallet();
    getFactoryMetrics.mockResolvedValue({ totalDeployed: 2, recentTokens: [] });
  });

  it('calls getFactoryMetrics again when refresh button is clicked', async () => {
    renderFactory();
    await waitFor(() => expect(getFactoryMetrics).toHaveBeenCalledTimes(1));

    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshButton);

    await waitFor(() => expect(getFactoryMetrics).toHaveBeenCalledTimes(2));
  });
});

describe('TokenFactory — accessibility', () => {
  beforeEach(() => {
    withConnectedWallet();
    getFactoryMetrics.mockResolvedValue({
      totalDeployed: 1,
      recentTokens: [MOCK_TOKEN],
    });
  });

  it('deploy form inputs have associated labels', async () => {
    renderFactory();
    expect(await screen.findByLabelText(/token name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/symbol/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/decimals/i)).toBeInTheDocument();
  });

  it('wallet nudge banner has role="alert"', async () => {
    withDisconnectedWallet();
    renderFactory();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('deployments table has an accessible aria-label', async () => {
    renderFactory();
    expect(
      await screen.findByRole('table', { name: /recent token deployments/i }),
    ).toBeInTheDocument();
  });

  it('metrics region has an aria-label', async () => {
    renderFactory();
    await screen.findByRole('heading', { level: 1, name: /token factory/i });
    expect(screen.getByLabelText(/factory metrics/i)).toBeInTheDocument();
  });

  it('deploy form button is aria-disabled while deploying', async () => {
    // Delay deployToken so the button stays in loading state
    deployToken.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(MOCK_TOKEN), 500)),
    );

    renderFactory();
    const nameInput = await screen.findByLabelText(/token name/i);
    const symbolInput = screen.getByLabelText(/symbol/i);

    fireEvent.change(nameInput, { target: { value: 'Stellar Gold' } });
    fireEvent.change(symbolInput, { target: { value: 'SGLD' } });
    fireEvent.click(screen.getByRole('button', { name: /deploy token/i }));

    expect(
      await screen.findByRole('button', { name: /deploying/i }),
    ).toBeDisabled();
  });
});
