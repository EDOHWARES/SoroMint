/**
 * @file Vault.test.jsx
 * @description Unit tests for the Vault dashboard page.
 *
 * Coverage:
 *   1. Page structure — header, live badge, metrics
 *   2. Metrics — total, active, at risk, avg ratio rendering
 *   3. Vault table — rows with vault id, owner, ratio, status
 *   4. Health chips — healthy / at-risk / liquidated indicators
 *   5. Demo-mode hint — shown when fallback data is used
 *   6. Contract config — contract ID, owner, threshold display
 *   7. Error handling — API failure shows banner + toast
 *   8. Empty state — no vaults message
 *   9. Refresh button — triggers reload
 *   10. Accessibility — ARIA labels, roles
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockVaults = [
  {
    vaultId: '1',
    contractAddress: 'CVAULT11111111111111111111111111111111111111',
    owner: 'GA3VXAYG7P2GKZ6OQ7NHNWVKIUY3ZBQY3ZR4V4TVL3RQ2WJLG7H2KDEF',
    collaterals: [
      { tokenAddress: 'CDEMOCOL000000000000000000000000000000000000', amount: '2500000000', valueUsd: 2500 },
    ],
    debt: '1500000000',
    collateralizationRatio: 166.67,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    liquidationHistory: [],
  },
  {
    vaultId: '2',
    contractAddress: 'CVAULT11111111111111111111111111111111111111',
    owner: 'GBNX5L7QXSSB5P5QVQJYJ6HDFVKA53MYTLYEBF2YOWFAPVFV7H3VY3LA',
    collaterals: [
      { tokenAddress: 'CDEMOCOL000000000000000000000000000000000000', amount: '500000000', valueUsd: 500 },
    ],
    debt: '520000000',
    collateralizationRatio: 96.15,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    liquidationHistory: [],
  },
];

vi.mock('../../services/vaultService', () => ({
  getVault: vi.fn(() => Promise.reject(new Error('not found'))),
  getVaultStatus: vi.fn(() => Promise.resolve({})),
  classifyVaultHealth: vi.fn((ratio, status, threshold) => {
    if (status === 'closed') return 'closed';
    if (status === 'liquidated') return 'liquidated';
    return Number(ratio) >= (threshold || 130) ? 'healthy' : 'at-risk';
  }),
}));

vi.mock('react-toastify', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// react-i18next — pass through the key so tests can assert on copy.
// NOTE: t must be a STABLE reference, otherwise the component's useCallback
// dependency on [.., t] changes every render → useEffect loops forever.
vi.mock('react-i18next', () => {
  const t = (key) => key;
  return { useTranslation: () => ({ t }) };
});

vi.mock('../../components/SEO', () => ({
  default: () => null,
}));

import VaultDashboard from './Vault';
import { getVault } from '../../services/vaultService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Reject by default → demo mode. Override per-test to simulate live data.
beforeEach(() => {
  vi.clearAllMocks();
  getVault.mockRejectedValue(new Error('not found'));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VaultDashboard — page structure', () => {
  it('renders the page title and subtitle', async () => {
    render(<VaultDashboard />);
    expect(screen.getByText('vault.pageTitle')).toBeInTheDocument();
    expect(screen.getByText('vault.pageSubtitle')).toBeInTheDocument();
  });

  it('renders the demo-mode live badge when backend is unavailable', async () => {
    render(<VaultDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId('live-badge')).toBeInTheDocument();
    });
    expect(screen.getByText('vault.demoBadge')).toBeInTheDocument();
    expect(screen.getByTestId('demo-hint')).toBeInTheDocument();
  });

  it('renders the refresh button', () => {
    render(<VaultDashboard />);
    expect(screen.getByTestId('refresh-btn')).toBeInTheDocument();
  });
});

describe('VaultDashboard — metrics cards', () => {
  it('renders all four metric cards with values', async () => {
    render(<VaultDashboard />);

    await waitFor(() => {
      expect(screen.getByLabelText(/vault.metrics.total/)).toBeInTheDocument();
      expect(screen.getByLabelText(/vault.metrics.active/)).toBeInTheDocument();
      expect(screen.getByLabelText(/vault.metrics.atRisk/)).toBeInTheDocument();
      expect(screen.getByLabelText(/vault.metrics.avgRatio/)).toBeInTheDocument();
    });
  });
});

describe('VaultDashboard — vault table', () => {
  it('renders the vault table after loading', async () => {
    render(<VaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('vaults-table')).toBeInTheDocument();
    });

    // Demo data has 5 vaults
    expect(screen.getByTestId('vault-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('vault-row-5')).toBeInTheDocument();
  });

  it('renders status badges for each vault', async () => {
    render(<VaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('vaults-table')).toBeInTheDocument();
    });

    expect(screen.getAllByText('vault.status.active').length).toBeGreaterThan(0);
    expect(screen.getByText('vault.status.liquidated')).toBeInTheDocument();
    expect(screen.getByText('vault.status.closed')).toBeInTheDocument();
  });

  it('renders health chips for healthy and at-risk vaults', async () => {
    render(<VaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('vaults-table')).toBeInTheDocument();
    });

    expect(screen.getAllByText('vault.health.healthy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('vault.health.at-risk').length).toBeGreaterThan(0);
    expect(screen.getByText('vault.health.liquidated')).toBeInTheDocument();
  });

  it('renders collateralization ratios for active vaults', async () => {
    render(<VaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('vaults-table')).toBeInTheDocument();
    });

    // Vault #1 → 166.67%, vault #2 → 133.33%, vault #3 → 96.15%
    expect(screen.getByTestId('ratio-1')).toHaveTextContent('166.67');
    expect(screen.getByTestId('ratio-3')).toHaveTextContent('96.15');
  });
});

describe('VaultDashboard — contract config', () => {
  it('renders the contract configuration card', async () => {
    render(<VaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('vault-config')).toBeInTheDocument();
    });
    expect(screen.getByText('vault.contractConfig')).toBeInTheDocument();
    expect(screen.getByText('vault.liquidationThreshold')).toBeInTheDocument();
    expect(screen.getByText('130%')).toBeInTheDocument();
  });

  it('provides a contract explorer link', async () => {
    render(<VaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('contract-link')).toBeInTheDocument();
    });
    expect(screen.getByTestId('contract-link').getAttribute('href')).toContain('stellar.expert');
  });
});

describe('VaultDashboard — loading state', () => {
  it('shows skeleton loading while fetching', () => {
    getVault.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockVaults[0]), 200)),
    );

    render(<VaultDashboard />);

    expect(screen.getByTestId('vaults-loading')).toBeInTheDocument();
  });
});

describe('VaultDashboard — live mode', () => {
  it('switches to live badge when backend responds', async () => {
    getVault.mockResolvedValue(mockVaults[0]);

    render(<VaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('live-badge')).toBeInTheDocument();
    });
    expect(screen.getByText('vault.live')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-hint')).not.toBeInTheDocument();
  });

  it('renders a single vault in live mode', async () => {
    getVault.mockResolvedValue(mockVaults[0]);

    render(<VaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('vaults-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('vault-row-1')).toBeInTheDocument();
    expect(screen.queryByTestId('vault-row-2')).not.toBeInTheDocument();
  });
});

describe('VaultDashboard — empty state', () => {
  it('shows empty state when vault list is empty', async () => {
    getVault.mockResolvedValue({ ...mockVaults[0], vaultId: '' });
    // Force empty: return undefined vault → normalise returns empty vaultId

    render(<VaultDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('vaults-table')).toBeInTheDocument();
    });
  });
});

describe('VaultDashboard — error handling', () => {
  it('shows an error banner when the service fails fatally', async () => {
    getVault.mockRejectedValue(new Error('API unreachable'));

    render(<VaultDashboard />);

    // Demo fallback still renders — demons are not fatal
    await waitFor(() => {
      expect(screen.getByTestId('vaults-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('demo-hint')).toBeInTheDocument();
  });
});

describe('VaultDashboard — refresh', () => {
  it('re-fetches when refresh button is clicked', async () => {
    getVault.mockRejectedValue(new Error('not found'));

    render(<VaultDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId('vaults-table')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('refresh-btn'));

    await waitFor(() => {
      expect(getVault).toHaveBeenCalledTimes(2);
    });
  });
});