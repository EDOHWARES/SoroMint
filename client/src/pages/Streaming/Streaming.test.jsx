/**
 * @file Streaming.test.jsx
 * @description Unit tests for the Streaming dashboard page.
 *
 * Coverage:
 *   1. Page structure — header, live badge, metrics
 *   2. Metrics — total, active, completed, total rate rendering
 *   3. Stream table — rows with stream id, sender, recipient, status
 *   4. Status badges — active / completed / cancelled indicators
 *   5. Visibility badges — public / private indicators
 *   6. Demo-mode hint — shown when fallback data is used
 *   7. Contract config — contract ID, owner, window display
 *   8. Error handling — API failure shows banner + toast
 *   9. Refresh button — triggers reload
 *   10. Accessibility — ARIA labels, roles
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockStreams = [
  {
    streamId: '1',
    sender: 'GA3VXAYG7P2GKZ6OQ7NHNWVKIUY3ZBQY3ZR4V4TVL3RQ2WJLG7H2KDEF',
    recipient: 'GBNX5L7QXSSB5P5QVQJYJ6HDFVKA53MYTLYEBF2YOWFAPVFV7H3VY3LA',
    token: 'CDEMOTOK00000000000000000000000000000000000000',
    ratePerLedger: '1000000',
    startLedger: 1100000,
    stopLedger: 2100000,
    withdrawn: '250000000',
    totalAmount: '1000000000',
    isPublic: true,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    streamId: '2',
    sender: 'GCSXBVPXDJYZC6N2H5LQG5GKPPT4FBWQJWFSVEZ5S6Y7TSG4PYUGXFMT',
    recipient: 'GDMX2YVGK5LYYIHZ3QUBEKEPZHYOJKANQ77GHYJ5MGLKBQC2SJMYMD7B',
    token: 'CDEMOTOK00000000000000000000000000000000000000',
    ratePerLedger: '500000',
    startLedger: 1000000,
    stopLedger: 2000000,
    withdrawn: '120000000',
    totalAmount: '500000000',
    isPublic: false,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

vi.mock('../../services/streamingService', () => ({
  getStream: vi.fn(() => Promise.reject(new Error('not found'))),
  getStreamStatus: vi.fn(() => Promise.resolve({})),
  classifyStreamStatus: vi.fn((stream, currentLedger = 0) => {
    const status = stream.status || 'active';
    if (status === 'completed' || status === 'cancelled' || status === 'scheduled') {
      return status;
    }
    if (currentLedger > 0 && stream.stopLedger > 0) {
      if (currentLedger < stream.startLedger) return 'scheduled';
      if (currentLedger > stream.stopLedger) return 'completed';
    }
    return 'active';
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

import StreamingDashboard from './Streaming';
import { getStream } from '../../services/streamingService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Reject by default → demo mode. Override per-test to simulate live data.
beforeEach(() => {
  vi.clearAllMocks();
  getStream.mockRejectedValue(new Error('not found'));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StreamingDashboard — page structure', () => {
  it('renders the page title and subtitle', async () => {
    render(<StreamingDashboard />);
    expect(screen.getByText('streaming.pageTitle')).toBeInTheDocument();
    expect(screen.getByText('streaming.pageSubtitle')).toBeInTheDocument();
  });

  it('renders the demo-mode live badge when backend is unavailable', async () => {
    render(<StreamingDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId('live-badge')).toBeInTheDocument();
    });
    expect(screen.getByText('streaming.demoBadge')).toBeInTheDocument();
    expect(screen.getByTestId('demo-hint')).toBeInTheDocument();
  });

  it('renders the refresh button', () => {
    render(<StreamingDashboard />);
    expect(screen.getByTestId('refresh-btn')).toBeInTheDocument();
  });
});

describe('StreamingDashboard — metrics cards', () => {
  it('renders all four metric cards with values', async () => {
    render(<StreamingDashboard />);

    await waitFor(() => {
      expect(screen.getByLabelText(/streaming.metrics.total/)).toBeInTheDocument();
      expect(screen.getByLabelText(/streaming.metrics.active/)).toBeInTheDocument();
      expect(screen.getByLabelText(/streaming.metrics.completed/)).toBeInTheDocument();
      expect(screen.getByLabelText(/streaming.metrics.rate/)).toBeInTheDocument();
    });
  });
});

describe('StreamingDashboard — stream table', () => {
  it('renders the stream table after loading', async () => {
    render(<StreamingDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('streams-table')).toBeInTheDocument();
    });

    // Demo data has 5 streams
    expect(screen.getByTestId('stream-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('stream-row-5')).toBeInTheDocument();
  });

  it('renders status badges for each stream', async () => {
    render(<StreamingDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('streams-table')).toBeInTheDocument();
    });

    expect(screen.getAllByText('streaming.status.active').length).toBeGreaterThan(0);
    expect(screen.getByText('streaming.status.completed')).toBeInTheDocument();
    expect(screen.getByText('streaming.status.cancelled')).toBeInTheDocument();
  });

  it('renders visibility badges for public and private streams', async () => {
    render(<StreamingDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('streams-table')).toBeInTheDocument();
    });

    expect(screen.getAllByTestId('visibility-public').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('visibility-private').length).toBeGreaterThan(0);
  });
});

describe('StreamingDashboard — contract config', () => {
  it('renders the contract configuration card', async () => {
    render(<StreamingDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('streaming-config')).toBeInTheDocument();
    });
    expect(screen.getByText('streaming.contractConfig')).toBeInTheDocument();
    expect(screen.getByText('streaming.maxWindow')).toBeInTheDocument();
  });

  it('provides a contract explorer link', async () => {
    render(<StreamingDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('contract-link')).toBeInTheDocument();
    });
    expect(screen.getByTestId('contract-link').getAttribute('href')).toContain('stellar.expert');
  });
});

describe('StreamingDashboard — loading state', () => {
  it('shows skeleton loading while fetching', () => {
    getStream.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockStreams[0]), 200)),
    );

    render(<StreamingDashboard />);

    expect(screen.getByTestId('streams-loading')).toBeInTheDocument();
  });
});

describe('StreamingDashboard — live mode', () => {
  it('switches to live badge when backend responds', async () => {
    getStream.mockImplementation((id) =>
      Promise.resolve({ ...mockStreams[0], streamId: String(id) }),
    );

    render(<StreamingDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('live-badge')).toBeInTheDocument();
    });
    expect(screen.getByText('streaming.live')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-hint')).not.toBeInTheDocument();
  });

  it('renders live streams in the table', async () => {
    getStream.mockImplementation((id) =>
      Promise.resolve({ ...mockStreams[Number(id) % 2], streamId: String(id) }),
    );

    render(<StreamingDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId('streams-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stream-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('stream-row-5')).toBeInTheDocument();
  });
});

describe('StreamingDashboard — error handling', () => {
  it('shows demo fallback and demo hint when the service fails fatally', async () => {
    getStream.mockRejectedValue(new Error('API unreachable'));

    render(<StreamingDashboard />);

    // Demo fallback still renders — backend absence is not fatal
    await waitFor(() => {
      expect(screen.getByTestId('streams-table')).toBeInTheDocument();
    });
    expect(screen.getByTestId('demo-hint')).toBeInTheDocument();
  });
});

describe('StreamingDashboard — refresh', () => {
  it('re-fetches when refresh button is clicked', async () => {
    getStream.mockRejectedValue(new Error('not found'));

    render(<StreamingDashboard />);
    await waitFor(() => {
      expect(screen.getByTestId('streams-table')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('refresh-btn'));

    await waitFor(() => {
      expect(getStream).toHaveBeenCalledTimes(10);
    });
  });
});