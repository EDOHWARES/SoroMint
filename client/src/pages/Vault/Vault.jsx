/**
 * @title Vault Dashboard
 * @notice Full-featured dashboard for monitoring and operating the SoroMint
 *         Vault (collateralized lending) contract.
 *
 * The Vault allows users to lock collateral (e.g. USDC, xSMT) and mint
 * SMT stablecoins against it. If the collateralization ratio falls below the
 * liquidation threshold (130%) the vault becomes liquidatable.
 *
 * Layout (responsive):
 *   ┌──────────────────────────────────────────────────┐
 *   │  Page header + Live badge + refresh button        │
 *   ├───────────┬───────────┬───────────┬───────────────┤
 *   │  Total    │  Active   │ At risk   │ Avg ratio     │
 *   ├───────────┴───────────┴───────────┴───────────────┤
 *   │  Contract configuration (contractId, owner, ...)  │
 *   ├───────────────────────────────────────────────────┤
 *   │  Vault table (vaultId, owner, collateral, debt,   │
 *   │            ratio, status, updated)                │
 *   └───────────────────────────────────────────────────┘
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  Landmark,
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
} from 'lucide-react';

import SEO from '../../components/SEO';
import {
  getVault,
  classifyVaultHealth,
} from '../../services/vaultService';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONTRACT_ID = 'CVAULTVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVLT';
const DEFAULT_VAULT_ID = '1';
const LIQUIDATION_THRESHOLD = 130;

// ─── Demo data used when backend endpoints are not deployed ──────────────────

const DEMO_VAULTS = [
  {
    vaultId: '1',
    contractAddress: DEFAULT_CONTRACT_ID,
    owner: 'GA3VXAYG7P2GKZ6OQ7NHNWVKIUY3ZBQY3ZR4V4TVL3RQ2WJLG7H2KDEF',
    collaterals: [
      { tokenAddress: 'CDEMOCOL000000000000000000000000000000000000', amount: '2500000000', valueUsd: 2500 },
    ],
    debt: '1500000000',
    collateralizationRatio: 166.67,
    status: 'active',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
    lastUpdated: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    liquidationHistory: [],
  },
  {
    vaultId: '2',
    contractAddress: DEFAULT_CONTRACT_ID,
    owner: 'GBNX5L7QXSSB5P5QVQJYJ6HDFVKA53MYTLYEBF2YOWFAPVFV7H3VY3LA',
    collaterals: [
      { tokenAddress: 'CDEMOCOL000000000000000000000000000000000000', amount: '1200000000', valueUsd: 1200 },
    ],
    debt: '900000000',
    collateralizationRatio: 133.33,
    status: 'active',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 8).toISOString(),
    lastUpdated: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    liquidationHistory: [],
  },
  {
    vaultId: '3',
    contractAddress: DEFAULT_CONTRACT_ID,
    owner: 'GCSXBVPXDJYZC6N2H5LQG5GKPPT4FBWQJWFSVEZ5S6Y7TSG4PYUGXFMT',
    collaterals: [
      { tokenAddress: 'CDEMOCOL000000000000000000000000000000000000', amount: '500000000', valueUsd: 500 },
    ],
    debt: '520000000',
    collateralizationRatio: 96.15,
    status: 'active',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    lastUpdated: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    liquidationHistory: [],
  },
  {
    vaultId: '4',
    contractAddress: DEFAULT_CONTRACT_ID,
    owner: 'GDMX2YVGK5LYYIHZ3QUBEKEPZHYOJKANQ77GHYJ5MGLKBQC2SJMYMD7B',
    collaterals: [
      { tokenAddress: 'CDEMOCOL000000000000000000000000000000000000', amount: '300000000', valueUsd: 300 },
    ],
    debt: '280000000',
    collateralizationRatio: 0,
    status: 'liquidated',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    lastUpdated: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
    liquidationHistory: [
      {
        liquidator: 'GA3VXAYG7P2GKZ6OQ7NHNWVKIUY3ZBQY3ZR4V4TVL3RQ2WJLG7H2KDEF',
        debtCovered: '280000000',
        collateralSeized: '300000000',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
      },
    ],
  },
  {
    vaultId: '5',
    contractAddress: DEFAULT_CONTRACT_ID,
    owner: 'GBKOAJSZIPLQYT6IIH2F2D5L6T4Q3GQRPFWJXK3HOCNW5MUAV7R2TYRG',
    collaterals: [
      { tokenAddress: 'CDEMOCOL000000000000000000000000000000000000', amount: '100000000', valueUsd: 100 },
    ],
    debt: '0',
    collateralizationRatio: 0,
    status: 'closed',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20).toISOString(),
    lastUpdated: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
    liquidationHistory: [],
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
 * @param {string|number} raw - Scaled integer amount (e.g. 1500000000)
 * @param {number} [decimals=7] - Token decimals
 * @returns {string} e.g. "150.000"
 */
const formatAmount = (raw, decimals = 7) => {
  if (raw === null || raw === undefined || raw === '—') return '—';
  const value = Number(raw) / 10 ** decimals;
  if (Number.isNaN(value)) return '—';
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
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
        ? (t('vault.demoBadge') || 'Demo Mode')
        : (t('vault.live') || 'Live')}
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
    liquidated: {
      cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      Icon: XCircle,
    },
    closed: {
      cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
      Icon: Activity,
    },
  };
  const { cls, Icon } = map[status] || map.closed;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      <Icon size={12} />
      {t(`vault.status.${status}`) || status}
    </span>
  );
}

// ─── Sub-component: Health indicator ──────────────────────────────────────────

function HealthChip({ vault }) {
  const { t } = useTranslation();
  const health = classifyVaultHealth(vault.collateralizationRatio, vault.status, LIQUIDATION_THRESHOLD);
  const styles = {
    healthy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    'at-risk': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    liquidated: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    closed: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[health]}`}
      data-testid={`health-${vault.vaultId}`}
    >
      {health === 'healthy' && <ShieldCheck size={12} />}
      {health === 'at-risk' && <AlertTriangle size={12} />}
      {health === 'liquidated' && <XCircle size={12} />}
      {health === 'closed' && <Activity size={12} />}
      {t(`vault.health.${health}`) || health}
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
      toast.error(t('vault.copyFailed') || 'Failed to copy');
    }
  };

  return (
    <div className="glass-card !p-5" data-testid="vault-config">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <Landmark size={16} className="text-stellar-blue" />
          {t('vault.contractConfig') || 'Contract Configuration'}
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
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('vault.contractId') || 'Contract ID'}</span>
            <button
              type="button"
              onClick={() => copyText(config.contractId || DEFAULT_CONTRACT_ID)}
              className="inline-flex items-center gap-1.5 font-mono text-sm text-stellar-blue hover:underline"
              data-testid="copy-contract-id"
              aria-label={t('vault.copy') || 'Copy contract ID'}
            >
              {copied ? (
                <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                  <CheckCircle2 size={12} />
                  {t('vault.copied') || 'Copied'}
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
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('vault.owner') || 'Admin'}</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-sm text-slate-700 dark:text-slate-300">
              <Wallet size={12} />
              {truncateAddress(config.owner || '—')}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('vault.liquidationThreshold') || 'Liquidation Threshold'}
            </span>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {config.threshold ?? LIQUIDATION_THRESHOLD}%
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('vault.contractLink') || 'Contract Link'}</span>
            <a
              href={`https://stellar.expert/explorer/testnet/contract/${config.contractId || DEFAULT_CONTRACT_ID}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-stellar-blue hover:underline"
              data-testid="contract-link"
            >
              <Link2 size={12} />
              {t('vault.viewExplorer') || 'View on Explorer'}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: Vault table ───────────────────────────────────────────────

function VaultTable({ vaults, isLoading }) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="glass-card" data-testid="vaults-loading">
        <div className="space-y-4 !p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-5 w-24 animate-pulse rounded bg-black/8 dark:bg-white/10" />
              <div className="h-5 w-48 animate-pulse rounded bg-black/8 dark:bg-white/10" />
              <div className="h-5 w-28 animate-pulse rounded bg-black/8 dark:bg-white/10" />
              <div className="h-5 w-24 animate-pulse rounded bg-black/8 dark:bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!vaults || vaults.length === 0) {
    return (
      <div className="glass-card flex min-h-[240px] flex-col items-center justify-center !p-5" data-testid="vaults-empty">
        <Landmark size={40} className="mb-3 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('vault.noVaults') || 'No vaults found'}
        </p>
      </div>
    );
  }

  const totalCollateral = (vault) =>
    vault.collaterals.reduce((sum, c) => sum + (Number(c.valueUsd) || 0), 0);

  return (
    <div className="glass-card !p-0 overflow-hidden" data-testid="vaults-table">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-black/5 dark:border-white/10 text-sm text-slate-500 dark:text-slate-400">
              <th className="px-5 pb-3 pt-4 font-medium">{t('vault.colVaultId') || 'Vault'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('vault.colOwner') || 'Owner'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('vault.colCollateral') || 'Collateral'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('vault.colDebt') || 'Debt (SMT)'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('vault.colRatio') || 'Ratio'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('vault.colHealth') || 'Health'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('vault.colStatus') || 'Status'}</th>
              <th className="px-5 pb-3 pt-4 font-medium">{t('vault.colUpdated') || 'Updated'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {vaults.map((vault) => (
              <tr
                key={vault.vaultId}
                className="group transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                data-testid={`vault-row-${vault.vaultId}`}
              >
                <td className="px-5 py-3 font-mono text-sm text-stellar-blue">
                  #{vault.vaultId}
                </td>
                <td className="px-5 py-3 font-mono text-sm text-slate-600 dark:text-slate-400">
                  {truncateAddress(vault.owner)}
                </td>
                <td className="px-5 py-3 text-sm text-slate-700 dark:text-slate-300">
                  {vault.collaterals.length > 0 ? (
                    <span>
                      {formatAmount(vault.collaterals[0].amount) || '—'}
                      {totalCollateral(vault) > 0 && (
                        <span className="ml-1 text-xs text-slate-400">(${totalCollateral(vault).toLocaleString()})</span>
                      )}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-5 py-3 tabular-nums text-sm text-slate-700 dark:text-slate-300">
                  {formatAmount(vault.debt) || '—'}
                </td>
                <td
                  className="px-5 py-3 tabular-nums text-sm"
                  data-testid={`ratio-${vault.vaultId}`}
                >
                  {vault.status === 'closed' || vault.status === 'liquidated'
                    ? '—'
                    : `${vault.collateralizationRatio.toFixed(2)}%`}
                </td>
                <td className="px-5 py-3">
                  <HealthChip vault={vault} />
                </td>
                <td className="px-5 py-3">
                  <StatusBadge status={vault.status} />
                </td>
                <td className="px-5 py-3 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  {formatDate(vault.lastUpdated)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Vault Dashboard Component ───────────────────────────────────────────

function VaultDashboard({ contractId = DEFAULT_CONTRACT_ID }) {
  const { t } = useTranslation();
  const [vaults, setVaults] = useState([]);
  const [config, setConfig] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDemo, setIsDemo] = useState(false);

  // ─── Data fetching ─────────────────────────────────────────────────────────

  const fetchVaults = useCallback(async (showToast = false) => {
    setIsLoading(true);
    setError(null);
    try {
      // Try the live endpoint first; fall back to demo data for an overview.
      let data = [];
      let demoUsed = false;
      try {
        const single = await getVault(DEFAULT_VAULT_ID, contractId, null, null);
        data = [single];
      } catch {
        // No live backend — use the demo vault list.
        data = DEMO_VAULTS;
        demoUsed = true;
      }
      setVaults(data);
      setConfig({
        contractId,
        owner: 'GASMINTADMIN0000000000000000000000000000000000000',
        threshold: LIQUIDATION_THRESHOLD,
      });
      setIsDemo(demoUsed);
      if (showToast && demoUsed) {
        toast.info(t('vault.demoMode') || 'Running in demo mode — using mock data');
      }
    } catch (err) {
      setError(err.message);
      toast.error(`${t('vault.fetchError') || 'Failed to load vault data'}: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [contractId, t]);

  useEffect(() => {
    fetchVaults(true);
  }, [fetchVaults]);

  // ─── Metrics ───────────────────────────────────────────────────────────────

  const totalCount = vaults.length;
  const activeCount = vaults.filter((v) => v.status === 'active').length;
  const atRiskCount = vaults.filter(
    (v) =>
      v.status === 'active' &&
      classifyVaultHealth(v.collateralizationRatio, v.status, LIQUIDATION_THRESHOLD) === 'at-risk',
  ).length;
  const activeWithRatio = vaults.filter(
    (v) => v.status === 'active' && v.collateralizationRatio > 0,
  );
  const avgRatio =
    activeWithRatio.length > 0
      ? activeWithRatio.reduce((sum, v) => sum + v.collateralizationRatio, 0) /
        activeWithRatio.length
      : 0;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <SEO title={t('vault.pageTitle') || 'Vault'} />

      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {t('vault.pageTitle') || 'Vault'}
            </h1>
            <LiveBadge isDemo={isDemo} />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('vault.pageSubtitle') ||
              'Mint SMT against collateral — monitor ratios and liquidation risk'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchVaults(true)}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          data-testid="refresh-btn"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          {t('vault.refreshButton') || 'Refresh'}
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
            {t('vault.demoHint') || 'Running in demo mode — backend API not connected. Showing mock data.'}
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
          label={t('vault.metrics.total') || 'Total Vaults'}
          value={isLoading ? '—' : totalCount.toLocaleString()}
          icon={Landmark}
          color="bg-stellar-blue"
          isLoading={isLoading}
        />
        <MetricCard
          label={t('vault.metrics.active') || 'Active'}
          value={isLoading ? '—' : activeCount.toLocaleString()}
          icon={CheckCircle2}
          color="bg-green-500"
          isLoading={isLoading}
        />
        <MetricCard
          label={t('vault.metrics.atRisk') || 'At Risk'}
          value={isLoading ? '—' : atRiskCount.toLocaleString()}
          icon={AlertTriangle}
          color="bg-amber-500"
          isLoading={isLoading}
        />
        <MetricCard
          label={t('vault.metrics.avgRatio') || 'Avg Collateralization'}
          value={isLoading ? '—' : `${avgRatio.toFixed(1)}%`}
          icon={TrendingUp}
          color="bg-violet-500"
          isLoading={isLoading}
        />
      </div>

      {/* Contract configuration */}
      <div className="mb-4">
        <ConfigCard config={config} isLoading={isLoading} />
      </div>

      {/* Vault table */}
      <VaultTable vaults={vaults} isLoading={isLoading} />
    </>
  );
}

export default VaultDashboard;