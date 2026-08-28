/**
 * @file Compliance.test.jsx
 * @description Unit tests for the Compliance dashboard page.
 *
 * Coverage:
 *   1. Page structure — header, badge, metrics, config card
 *   2. Blacklist table — rows render with status + reason
 *   3. Clawback table — records render with amount + jurisdiction
 *   4. Demo-mode hint — shown when fallback data is used
 *   5. Error handling — API failure shows banner + toast
 *   6. Refresh button — triggers reload
 *   7. Accessibility — ARIA labels
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockStatus = {
  blacklistCount: 3,
  clawbackCount: 2,
  eventCount: 27,
  jurisdiction: 'US',
  admin: 'GADMINXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXMIN',
  clawbackAdmin: 'GCLAWBACKXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXBACK',
  tokenAddress: 'CSMTTOKENXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXKEN',
};

const mockBlacklist = [
  {
    address: 'GBADD01XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX01',
    banned: true,
    reason: 'Sanctions match',
    updatedAt: '2026-08-20T09:15:00Z',
  },
  {
    address: 'GBADD02XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX02',
    banned: true,
    reason: 'AML suspicious activity',
    updatedAt: '2026-08-18T14:30:00Z',
  },
];

const mockClawbacks = [
  {
    id: 2,
    source: 'GBADD01XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX01',
    amount: 5000,
    reason: 'fraud',
    jurisdiction: 'US',
    timestamp: '2026-08-21T10:05:00Z',
  },
  {
    id: 1,
    source: 'GBADD02XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX02',
    amount: 1200,
    reason: 'sanctions',
    jurisdiction: 'US',
    timestamp: '2026-08-19T16:45:00Z',
  },
];

vi.mock('../../services/complianceService', () => ({
  getComplianceStatus: vi.fn(),
  getBlacklist: vi.fn(),
  getClawbacks: vi.fn(),
  formatBlacklistEntry: vi.fn((entry) => ({
    id: entry.address,
    address: entry.address,
    banned: entry.banned,
    reason: entry.reason,
    updatedAt: entry.updatedAt,
  })),
  formatClawbackRecord: vi.fn((record) => ({
    id: record.id,
    source: record.source,
    amount: record.amount,
    reason: record.reason,
    jurisdiction: record.jurisdiction,
    timestamp: record.timestamp,
  })),
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

import ComplianceDashboard from './Compliance';
import {
  getComplianceStatus,
  getBlacklist,
  getClawbacks,
} from '../../services/complianceService';

describe('ComplianceDashboard — page structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getComplianceStatus.mockResolvedValue({ ...mockStatus });
    getBlacklist.mockResolvedValue(mockBlacklist.map((b) => ({ ...b })));
    getClawbacks.mockResolvedValue(mockClawbacks.map((c) => ({ ...c })));
  });

  it('renders the page title and subtitle', async () => {
    render(<ComplianceDashboard />);

    expect(screen.getByText('compliance.pageTitle')).toBeInTheDocument();
    expect(screen.getByText('compliance.pageSubtitle')).toBeInTheDocument();
  });

  it('renders the compliance badge', async () => {
    render(<ComplianceDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('compliance-badge')).toBeInTheDocument();
    });
  });

  it('renders all four metric cards', async () => {
    render(<ComplianceDashboard />);

    await waitFor(() => {
      expect(screen.getByLabelText(/compliance.metrics.blacklisted/)).toBeInTheDocument();
      expect(screen.getByLabelText(/compliance.metrics.clawbacks/)).toBeInTheDocument();
      expect(screen.getByLabelText(/compliance.metrics.events/)).toBeInTheDocument();
      expect(screen.getByLabelText(/compliance.metrics.jurisdiction/)).toBeInTheDocument();
    });

    // Metric values from demo/status data
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('27').length).toBeGreaterThan(0);
  });

  it('renders the contract configuration card', async () => {
    render(<ComplianceDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('config-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('config-admin')).toBeInTheDocument();
    expect(screen.getByTestId('config-clawback-admin')).toBeInTheDocument();
    expect(screen.getByTestId('config-token')).toBeInTheDocument();
    expect(screen.getByTestId('config-jurisdiction')).toBeInTheDocument();
  });
});

describe('ComplianceDashboard — blacklist table', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getComplianceStatus.mockResolvedValue({ ...mockStatus });
    getBlacklist.mockResolvedValue(mockBlacklist.map((b) => ({ ...b })));
    getClawbacks.mockResolvedValue(mockClawbacks.map((c) => ({ ...c })));
  });

  it('renders the blacklist table with rows after loading', async () => {
    render(<ComplianceDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('blacklist-table')).toBeInTheDocument();
    });

    expect(screen.getByTestId('blacklist-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('blacklist-row-1')).toBeInTheDocument();
  });

  it('renders banned status for blacklist entries', async () => {
    render(<ComplianceDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('blacklist-table')).toBeInTheDocument();
    });

    expect(screen.getAllByText('compliance.bannedStatus').length).toBeGreaterThan(0);
    expect(screen.getByText('Sanctions match')).toBeInTheDocument();
  });

  it('shows the empty state when there are no blacklist entries', async () => {
    getBlacklist.mockResolvedValue([]);

    render(<ComplianceDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('blacklist-empty')).toBeInTheDocument();
    });
  });
});

describe('ComplianceDashboard — clawback records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getComplianceStatus.mockResolvedValue({ ...mockStatus });
    getBlacklist.mockResolvedValue(mockBlacklist.map((b) => ({ ...b })));
    getClawbacks.mockResolvedValue(mockClawbacks.map((c) => ({ ...c })));
  });

  it('renders the clawback table with records', async () => {
    render(<ComplianceDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('clawbacks-table')).toBeInTheDocument();
    });

    expect(screen.getByTestId('clawback-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('clawback-row-1')).toBeInTheDocument();
    expect(screen.getByText('fraud')).toBeInTheDocument();
    expect(screen.getByText('sanctions')).toBeInTheDocument();
  });

  it('shows the empty state when there are no clawback records', async () => {
    getClawbacks.mockResolvedValue([]);

    render(<ComplianceDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('clawbacks-empty')).toBeInTheDocument();
    });
  });
});

describe('ComplianceDashboard — loading & demo mode', () => {
  it('shows skeleton loading while fetching', () => {
    getComplianceStatus.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockStatus), 200)),
    );
    getBlacklist.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockBlacklist), 200)),
    );
    getClawbacks.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockClawbacks), 200)),
    );

    render(<ComplianceDashboard />);

    expect(screen.getByTestId('blacklist-loading')).toBeInTheDocument();
  });

  it('shows demo-mode hint when fallback data was used', async () => {
    // Simulate the real service behaviour on a downed backend: it returns the
    // fallback argument (same reference the component passed) — the component
    // detects demo mode via reference equality with its own DEMO_* constants.
    getComplianceStatus.mockImplementation((token, fallback) => Promise.resolve(fallback));
    getBlacklist.mockImplementation((token, fallback) => Promise.resolve(fallback));
    getClawbacks.mockImplementation((token, fallback) => Promise.resolve(fallback));

    render(<ComplianceDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('demo-hint')).toBeInTheDocument();
    });
  });
});

describe('ComplianceDashboard — error handling', () => {
  it('shows an error banner and toast when the service fails', async () => {
    getComplianceStatus.mockRejectedValue(new Error('API unreachable'));

    render(<ComplianceDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeInTheDocument();
    });
    expect(screen.getByText('API unreachable')).toBeInTheDocument();
  });
});

describe('ComplianceDashboard — refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getComplianceStatus.mockResolvedValue({ ...mockStatus });
    getBlacklist.mockResolvedValue(mockBlacklist.map((b) => ({ ...b })));
    getClawbacks.mockResolvedValue(mockClawbacks.map((c) => ({ ...c })));
  });

  it('re-fetches data when refresh is clicked', async () => {
    render(<ComplianceDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('refresh-btn')).toBeInTheDocument();
    });

    const callsBefore = getComplianceStatus.mock.calls.length;
    fireEvent.click(screen.getByTestId('refresh-btn'));

    await waitFor(() => {
      expect(getComplianceStatus.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});