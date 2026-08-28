/**
 * @file Oracle.test.jsx
 * @description Unit tests for the Oracle / Price Feed dashboard page.
 *
 * Coverage:
 *   1. Page structure — header, status pill, metric cards, price feed table
 *   2. Metrics — trusted sources, tracked assets, stale feeds
 *   3. Price feed — asset, price, source, updated time and status badges
 *   4. USD calculator — amount × price ÷ 10^decimals math
 *   5. Demo-mode hint — shown when backend proxy is not connected
 *   6. Error handling — API failure shows banner + toast
 *   7. Refresh button — triggers reload
 *   8. Accessibility — ARIA labels, roles
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Mock the oracle service so tests never hit the network
const NOW = Math.floor(Date.now() / 1000);

const mockStatus = {
  sources: [
    'GSRCONEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXONE',
    'GSRCTWOXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXTWO',
    'GSRCTHREXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXHREE',
  ],
  prices: [
    {
      token: 'CTOKENXLMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXLM',
      price: 1053,
      timestamp: NOW - 42,
      source: 'GSRCONEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXONE',
      decimals: 7,
    },
    {
      token: 'CTOKENUSDCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXSDC',
      price: 10000000,
      timestamp: NOW - 8,
      source: 'GSRCTWOXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXTWO',
      decimals: 7,
    },
    {
      token: 'CTOKENSORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXSOR',
      price: 87500000,
      timestamp: NOW - 120,
      source: 'GSRCTHREXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXHREE',
      decimals: 7,
    },
    {
      token: 'CTOKENARBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXARB',
      price: 4123000,
      timestamp: NOW - 9000,
      source: 'GSRCONEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXONE',
      decimals: 6,
    },
  ],
  version: '2.0.0',
};

vi.mock('../../services/oracleService', () => ({
  getOracleStatus: vi.fn(() => Promise.resolve(mockStatus)),
  formatPrice: vi.fn((price, decimals) => {
    const p = Number(price) || 0;
    const d = Number(decimals) || 0;
    if (d <= 0) return p.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return p.toLocaleString(undefined, { maximumFractionDigits: d });
  }),
  formatTimestamp: vi.fn((ts) => {
    if (!ts) return '—';
    const d = new Date(ts * 1000);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }),
  calculateUsdValue: vi.fn((tokenAmount, price, decimals) => {
    const amount = Number(tokenAmount) || 0;
    const p = Number(price) || 0;
    const d = Number(decimals) || 0;
    if (amount < 0) throw new Error('token_amount must be non-negative');
    const scale = 10 ** d;
    const raw = (amount * p) / scale;
    return Math.round(raw * 100) / 100;
  }),
  default: {},
}));

// react-toastify — capture calls without rendering the container
vi.mock('react-toastify', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// react-helmet-async — no-op wrapper
vi.mock('react-helmet-async', () => ({
  Helmet: () => null,
}));

// react-i18next — pass through the key so tests can assert on copy
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key || '',
  }),
}));

import OracleDashboard from './Oracle';
import { getOracleStatus } from '../../services/oracleService';

describe('OracleDashboard — page structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOracleStatus.mockResolvedValue({
      sources: [...mockStatus.sources],
      prices: mockStatus.prices.map((p) => ({ ...p })),
      version: mockStatus.version,
    });
  });

  it('renders the page title and subtitle', async () => {
    render(<OracleDashboard />);

    expect(screen.getByText('oracle.pageTitle')).toBeInTheDocument();
    expect(screen.getByText('oracle.pageSubtitle')).toBeInTheDocument();
  });

  it('renders the live status pill', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('oracle-status-pill')).toBeInTheDocument();
    });
  });

  it('renders the contract version badge', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('oracle-status-pill')).toBeInTheDocument();
    });
    expect(screen.getByText(/oracle\.contractVersion/)).toBeInTheDocument();
  });

  it('renders all four metric cards', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByLabelText(/oracle.metrics.sources/)).toBeInTheDocument();
      expect(screen.getByLabelText(/oracle.metrics.assets/)).toBeInTheDocument();
      expect(screen.getByLabelText(/oracle.metrics.stale/)).toBeInTheDocument();
      expect(screen.getByLabelText(/oracle.metrics.usd/)).toBeInTheDocument();
    });
  });

  it('shows the trusted source count', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByLabelText(/oracle.metrics.sources: 3/)).toBeInTheDocument();
    });
  });
});

describe('OracleDashboard — price feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOracleStatus.mockResolvedValue({
      sources: [...mockStatus.sources],
      prices: mockStatus.prices.map((p) => ({ ...p })),
      version: mockStatus.version,
    });
  });

  it('renders the price feed table header', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('price-feed-table')).toBeInTheDocument();
    });
    expect(screen.getByText('oracle.colAsset')).toBeInTheDocument();
    expect(screen.getByText('oracle.colPrice')).toBeInTheDocument();
    expect(screen.getByText('oracle.colSource')).toBeInTheDocument();
    expect(screen.getByText('oracle.colUpdated')).toBeInTheDocument();
    expect(screen.getByText('oracle.colStatus')).toBeInTheDocument();
  });

  it('renders a Fresh badge for recent feeds and a Stale badge for old ones', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('price-feed-table')).toBeInTheDocument();
    });
    // 4 rows: 3 fresh + 1 stale (ARB is 9000s old)
    expect(screen.getAllByText('oracle.fresh').length).toBe(3);
    expect(screen.getAllByText('oracle.stale').length).toBe(1);
  });

  it('truncates token addresses in the feed', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByText('CTOKENXL…XXXXLM')).toBeInTheDocument();
    });
    // truncateId: first 8 chars + … + last 6 chars
    // 'CTOKENXLMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXLM' -> 'CTOKENXL…XXXXLM'
  });
});

describe('OracleDashboard — trusted sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOracleStatus.mockResolvedValue({
      sources: [...mockStatus.sources],
      prices: mockStatus.prices.map((p) => ({ ...p })),
      version: mockStatus.version,
    });
  });

  it('renders the trusted sources card with all sources', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByText('oracle.trustedSources')).toBeInTheDocument();
    });
    // each source renders in both the price-feed table and the trusted-sources card
    expect(screen.getAllByText('GSRCONEX…XXXONE').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('GSRCTWOX…XXXTWO').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('GSRCTHRE…XXHREE').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the contract configuration rows', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByText('oracle.staleAge')).toBeInTheDocument();
    });
    expect(screen.getByText(/300s/)).toBeInTheDocument();
  });
});

describe('OracleDashboard — USD calculator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOracleStatus.mockResolvedValue({
      sources: [...mockStatus.sources],
      prices: mockStatus.prices.map((p) => ({ ...p })),
      version: mockStatus.version,
    });
  });

  it('shows dash before any amount is entered', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByText('oracle.usdCalculator')).toBeInTheDocument();
    });
    expect(screen.getByTestId('usd-result')).toHaveTextContent('—');
  });

  it('computes USD = amount × price ÷ 10^decimals for the selected asset', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByLabelText(/oracle.tokenAmountLabel/)).toBeInTheDocument();
    });

    // Selected asset defaults to first fresh feed: XLM price 1053, decimals 7
    // 100 × 1053 / 10^7 = 0.01053 -> 0.01
    fireEvent.change(screen.getByLabelText(/oracle.tokenAmountLabel/), {
      target: { value: '100' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('usd-result')).toHaveTextContent('$0.01');
    });
  });

  it('updates the value when the amount changes', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByLabelText(/oracle.tokenAmountLabel/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/oracle.tokenAmountLabel/), {
      target: { value: '10000' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('usd-result')).toHaveTextContent('$1.05');
    });
  });
});

describe('OracleDashboard — loading & demo mode', () => {
  it('skeleton-loads the metric cards while fetching', () => {
    getOracleStatus.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockStatus), 200)),
    );

    render(<OracleDashboard />);

    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows demo-mode hint when fallback data was used', async () => {
    getOracleStatus.mockResolvedValue({
      sources: [...mockStatus.sources],
      prices: mockStatus.prices.map((p) => ({ ...p })),
      version: mockStatus.version,
    });

    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('demo-hint')).toBeInTheDocument();
    });
  });
});

describe('OracleDashboard — error handling', () => {
  it('shows an error banner and toast when the service fails', async () => {
    getOracleStatus.mockRejectedValue(new Error('network down'));

    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/network down/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /oracle.refreshButton/ })).toBeInTheDocument();
  });
});

describe('OracleDashboard — refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOracleStatus.mockResolvedValue({
      sources: [...mockStatus.sources],
      prices: mockStatus.prices.map((p) => ({ ...p })),
      version: mockStatus.version,
    });
  });

  it('re-fetches status when refresh is clicked', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(getOracleStatus.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    const callsBefore = getOracleStatus.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /oracle.refreshButton/ }));

    await waitFor(() => {
      expect(getOracleStatus.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

describe('OracleDashboard — accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOracleStatus.mockResolvedValue({
      sources: [...mockStatus.sources],
      prices: mockStatus.prices.map((p) => ({ ...p })),
      version: mockStatus.version,
    });
  });

  it('exposes metric cards via aria-label', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByLabelText(/oracle.metrics.sources/)).toBeInTheDocument();
    });
  });

  it('exposes the amount input with an accessible name', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByLabelText(/oracle.tokenAmountLabel/)).toBeInTheDocument();
    });
  });

  it('renders the operations note', async () => {
    render(<OracleDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('ops-note')).toBeInTheDocument();
    });
    expect(screen.getByText('oracle.opsNote')).toBeInTheDocument();
  });
});