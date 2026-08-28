/**
 * @title Streaming Dashboard
 * @notice Full-featured dashboard for monitoring and operating the SoroMint
 *         Streaming (scheduled payments) contract.
 *
 * The Streaming contract lets users create payment streams: a sender locks a
 * token amount that vests linearly to a recipient between a start and stop
 * ledger. The recipient can withdraw the vested portion at any time.
 *
 * Layout (responsive):
 *   ┌──────────────────────────────────────────────────┐
 *   │  Page header + Live badge + refresh button        │
 *   ├───────────┬───────────┬───────────┬───────────────┤
 *   │  Total    │  Active   │ Completed │ Total rate    │
 *   ├───────────┴───────────┴───────────┴───────────────┤
 *   │  Contract configuration (contractId, admin, ...)  │
 *   ├───────────────────────────────────────────────────┤
 *   │  Stream table (id, sender, recipient, token,      │
 *   │            rate, window, withdrawn, status)       │
 *   └───────────────────────────────────────────────────┘
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  Radio,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Activity,
  TrendingUp,
  Copy,
  Link2,
  Wallet,
  Clock,
} from 'lucide-react';

import SEO from '../../components/SEO';
import {
  getStream,
  classifyStreamStatus,
} from '../../services/streamingService';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONTRACT_ID = 'CSTREAMING11111111111111111111111111111111PAY';
const DEMO_STREAM_IDS = ['1', '2', '3', '4', '5'];
const TOKEN_DECIMALS = 7;

// ─── Demo data used when backend endpoints are not deployed ──────────────────

const DEMO_STREAMS = [
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
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
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
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    streamId: '3',
    sender: 'GBKOAJSZIPLQYT6IIH2F2D5L6T4Q3GQRPFWJXK3HOCNW5MUAV7R2TYRG',
    recipient: 'GA3VXAYG7P2GKZ6OQ7NHNWVKIUY3ZBQY3ZR4V4TVL3RQ2WJLG7H2KDEF',
    token: 'CDEMOTOK00000000000000000000000000000000000000',
    ratePerLedger: '250000',
    startLedger: 900000,
    stopLedger: 1300000,
    withdrawn: '98000000',
    totalAmount: '100000000',
    isPublic: true,
    status: 'completed',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    streamId: '4',
    sender: 'GBNX5L7QXSSB5P5QVQJYJ6HDFVKA53MYTLYEBF2YOWFAPVFV7H3VY3LA',
    recipient: 'GCSXBVPXDJYZC6N2H5LQG5GKPPT4FBWQJWFSVEZ5S6Y7TSG4PYUGXFMT',
    token: 'CDEMOTOK00000000000000000000000000000000000000',
    ratePerLedger: '100000',
    startLedger: 800000,
    stopLedger: 1200000,
    withdrawn: '0',
    totalAmount: '40000000',
    isPublic: false,
    status: 'cancelled',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
  },
  {
    streamId: '5',
    sender: 'GDMX2YVGK5LYYIHZ3QUBEKEPZHYOJKANQ77GHYJ5MGLKBQC2SJMYMD7B',
    recipient: 'GBKOAJSZIPLQYT6IIH2F2D5L6T4Q3GQRPFWJXK3HOCNW5MUAV7R2TYRG',
    token: 'CDEMOTOK00000000000000000000000000000000000000',
    ratePerLedger: '750000',
    startLedger: 1150000,
    stopLedger: 2200000,
    withdrawn: '75000000',
    totalAmount: '750000000',
    isPublic: true,
    status: 'active',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * @notice Truncate a Stellar address to "GABC…WXYZ" form.
 */
const truncateAddress = (addr) => {
  if (!addr || addr === '—') return '—';
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
};

/**
 * @notice Format a date string to a locale-friendly display.
 */
const formatDate = (isoString) => {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

/**
 * @notice Format a raw (scaled) integer amount to a human-readable number.
 */
const formatAmount = (raw, decimals = TOKEN_DECIMALS) => {
  if (raw === null || raw === undefined || raw === '—') return '—';
  const value = Number(raw) / 10 ** decimals;
  if (Number.isNaN(value)) return '—';
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
};

/**
 * @notice Format a ledger range as a compact "start → stop" string.
 */
const formatLedgerRange = (start, stop) => {
  if (!start && !stop) return '—';
  return `${Number(start || 0).toLocaleString()} → ${Number(stop || 0).toLocaleString()}`;
};

// ─── Sub-component: Live badge ────────────────────────────────────────────────

function LiveBadge({ isDemo }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
        isDemo
          ? 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/30 dark:text-amber-400'
          : 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/30 dark:text-emerald-400'
      }`}
      data-testid="live-badge"
    >
      {isDemo ? (
        <AlertTriangle size={14} />
      ) : (
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
      )}
      {isDemo
        ? (t('streaming.demoBadge') || 'Demo Mode')
        : (t('streaming.live') || 'Live')}
    </span>
  );
}

// ─── Sub-component: Metric card ───────────────────────────────────────────────

function MetricCard({ label, value, icon: Icon, color, isLoading }) {
  return (
    <div className="glass-card flex flex-col gap-3 !p-5" aria-label={`${label}: ${value}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${color}`}>
          <Icon size={16} className="text-white" />
        </div>
      </div>
      {isLoading ? (
        <div className="h-7 w-20 animate-pulse rounded-lg bg-black/8 dark:bg-white/10" />
      ) : (
        <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
      )}
    </div>
  );
}

// ─── Sub-component: Status badge ──────────────────────────────────────────────

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const map = {
    active: {
      cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      Icon: CheckCircle2,
    },
    scheduled: {
      cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
      Icon: Clock,
    },
    completed: {
      cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
      Icon: Activity,
    },
    cancelled: {
      cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      Icon: XCircle,
    },
  };
  const { cls, Icon } = map[status] || map.active;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      <Icon size={12} />
      {t(`streaming.status.${status}`) || status}
    </span>
  );
}

// ─── Sub-component: Visibility badge ──────────────────────────────────────────

function VisibilityBadge({ isPublic }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        isPublic
          ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
      }`}
      data-testid={isPublic ? 'visibility-public' : 'visibility-private'}
    >
      {isPublic ? (t('streaming.public') || 'Public') : (t('streaming.private') || 'Private')}
    </span>
  );
}

// ─── Sub-component: Contract config card ──────────────────────────────────────

function ConfigCard({ config, isLoading }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t('streaming.copyFailed') || 'Failed to copy');
    }
  };

  return (
    <div className="glass-card !p-5" data-testid="streaming-config">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <Radio size={16} className="text-stellar-blue" />
          {t('streaming.contractConfig') || 'Contract Configuration'}
        </h2>
      </div>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-black/8 dark:bg-white/10" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('streaming.contractId') || 'Contract ID'}</span>
            <button
              type="button"
              onClick={() => copyText(config.contractId || DEFAULT_CONTRACT_ID)}
              className="inline-flex items-center gap-1.5 font-mono text-sm text-stellar-blue hover:underline"
              data-testid="copy-contract-id"
              aria-label={t('streaming.copy') || 'Copy contract ID'}
            >
              {copied ? (
                <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                  <CheckCircle2 size={12} />
                  {t('streaming.copied') || 'Copied'}
                </span>
              ) : (
                <>
                  <Copy size={12} />
                  {truncateAddress(config.contractId || DEFAULT_CONTRACT_ID)}
                </>
              )}
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('streaming.owner') || 'Admin'}</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-sm text-slate-700 dark:text-slate-300">
              <Wallet size={12} />
              {truncateAddress(config.owner || '—')}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('streaming.maxWindow') || 'Max Stream Window'}
            </span>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {config.maxWindow ? `${config.maxWindow.toLocaleString()} ledgers` : '—'}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('streaming.contractLink') || 'Contract Link'}</span>
            <a
              href={`https://stellar.expert/explorer/testnet/contract/${config.contractId || DEFAULT_CONTRACT_ID}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-stellar-blue hover:underline"
              data-testid="contract-link"
            >
              <Link2 size={12} />
              {t('streaming.viewExplorer') || 'View on Explorer'}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: Stream table ──────────────────────────────────────────────

function StreamTable({ streams, isLoading }) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="glass-card" data-testid="streams-loading">
        <div className="space-y-4 !p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-5 w-20 animate-pulse rounded bg-black/8 dark:bg-white/10" />
              <div className="h-5 w-40 animate-pulse rounded bg-black/8 dark:bg-white/10" />
              <div className="h-5 w-40 animate-pulse rounded bg-black/8 dark:bg-white/10" />
              <div className="h-5 w-28 animate-pulse rounded bg-black/8 dark:bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!streams || streams.length === 0) {
    return (
      <div className="glass-card flex min-h-[240px] flex-col items-center justify-center !p-5" data-testid="streams-empty">
        <Radio size={40} className="mb-3 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('streaming.noStreams') || 'No streams found'}
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card !p-0 overflow-hidden" data-testid="streams-table">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-black/5 dark:border-white/10 text-sm text-slate-500 dark:text-slate-400">
              <th className="px-5 pb-3 pt-4 font-medium">{t('streaming.colStreamId') || 'Stream'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('streaming.colSender') || 'Sender'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('streaming.colRecipient') || 'Recipient'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('streaming.colRate') || 'Rate'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('streaming.colWindow') || 'Window'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('streaming.colWithdrawn') || 'Withdrawn'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('streaming.colVisibility') || 'Visibility'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('streaming.colStatus') || 'Status'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {streams.map((stream) => {
              const status = classifyStreamStatus(stream);
              return (
                <tr
                  key={stream.streamId}
                  className="group transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                  data-testid={`stream-row-${stream.streamId}`}
                >
                  <td className="px-5 py-3 font-mono text-sm text-stellar-blue">
                    #{stream.streamId}
                  </td>
                  <td className="px-5 py-3 font-mono text-sm text-slate-600 dark:text-slate-400">
                    {truncateAddress(stream.sender)}
                  </td>
                  <td className="px-5 py-3 font-mono text-sm text-slate-600 dark:text-slate-400">
                    {truncateAddress(stream.recipient)}
                  </td>
                  <td className="px-5 py-3 tabular-nums text-sm text-slate-700 dark:text-slate-300">
                    {formatAmount(stream.ratePerLedger)}
                    <span className="ml-1 text-xs text-slate-400">/ledger</span>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    {formatLedgerRange(stream.startLedger, stream.stopLedger)}
                  </td>
                  <td className="px-5 py-3 tabular-nums text-sm text-slate-700 dark:text-slate-300">
                    {formatAmount(stream.withdrawn) || '—'}
                  </td>
                  <td className="px-5 py-3">
                    <VisibilityBadge isPublic={stream.isPublic} />
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Streaming Dashboard Component ───────────────────────────────────────

function StreamingDashboard({ contractId = DEFAULT_CONTRACT_ID }) {
  const { t } = useTranslation();
  const [streams, setStreams] = useState([]);
  const [config, setConfig] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDemo, setIsDemo] = useState(false);

  // ─── Data fetching ─────────────────────────────────────────────────────────

  const fetchStreams = useCallback(async (showToast = false) => {
    setIsLoading(true);
    setError(null);
    try {
      // Try the live endpoint first; fall back to demo data for an overview.
      let data = [];
      let demoUsed = false;
      try {
        const fetched = await Promise.all(
          DEMO_STREAM_IDS.map((id) => getStream(id, null, null)),
        );
        data = fetched.filter(Boolean);
        if (data.length === 0) throw new Error('no live streams');
      } catch {
        // No live backend — use the demo stream list.
        data = DEMO_STREAMS;
        demoUsed = true;
      }
      setStreams(data);
      setConfig({
        contractId,
        owner: 'GASMINTADMIN0000000000000000000000000000000000000',
        maxWindow: 1000000,
      });
      setIsDemo(demoUsed);
      if (showToast && demoUsed) {
        toast.info(t('streaming.demoMode') || 'Running in demo mode — using mock data');
      }
    } catch (err) {
      setError(err.message);
      toast.error(`${t('streaming.fetchError') || 'Failed to load streaming data'}: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [contractId, t]);

  useEffect(() => {
    fetchStreams(true);
  }, [fetchStreams]);

  // ─── Metrics ───────────────────────────────────────────────────────────────

  const totalCount = streams.length;
  const activeCount = streams.filter((s) => classifyStreamStatus(s) === 'active').length;
  const completedCount = streams.filter((s) => classifyStreamStatus(s) === 'completed').length;
  const totalRate = streams
    .filter((s) => classifyStreamStatus(s) === 'active')
    .reduce((sum, s) => sum + (Number(s.ratePerLedger) || 0), 0);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <SEO title={t('streaming.pageTitle') || 'Streaming'} />

      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {t('streaming.pageTitle') || 'Streaming'}
            </h1>
            <LiveBadge isDemo={isDemo} />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('streaming.pageSubtitle') ||
              'Create and monitor token streams — vest tokens linearly over time'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchStreams(true)}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          data-testid="refresh-btn"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          {t('streaming.refreshButton') || 'Refresh'}
        </button>
      </div>

      {/* Demo mode hint */}
      {isDemo && (
        <div
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/30 dark:bg-amber-900/20 dark:text-amber-400"
          data-testid="demo-hint"
          role="status"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle size={16} />
            {t('streaming.demoHint') || 'Running in demo mode — backend API not connected. Showing mock data.'}
          </span>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/30 dark:bg-red-900/20 dark:text-red-400"
          role="alert"
          data-testid="error-banner"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle size={16} />
            {error}
          </span>
        </div>
      )}

      {/* Metrics cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label={t('streaming.metrics.total') || 'Total Streams'}
          value={isLoading ? '—' : totalCount.toLocaleString()}
          icon={Radio}
          color="bg-stellar-blue"
          isLoading={isLoading}
        />
        <MetricCard
          label={t('streaming.metrics.active') || 'Active'}
          value={isLoading ? '—' : activeCount.toLocaleString()}
          icon={CheckCircle2}
          color="bg-green-500"
          isLoading={isLoading}
        />
        <MetricCard
          label={t('streaming.metrics.completed') || 'Completed'}
          value={isLoading ? '—' : completedCount.toLocaleString()}
          icon={Activity}
          color="bg-slate-500"
          isLoading={isLoading}
        />
        <MetricCard
          label={t('streaming.metrics.rate') || 'Total Rate / Ledger'}
          value={isLoading ? '—' : formatAmount(totalRate)}
          icon={TrendingUp}
          color="bg-violet-500"
          isLoading={isLoading}
        />
      </div>

      {/* Contract configuration */}
      <div className="mb-4">
        <ConfigCard config={config} isLoading={isLoading} />
      </div>

      {/* Stream table */}
      <StreamTable streams={streams} isLoading={isLoading} />
    </>
  );
}

export default StreamingDashboard;