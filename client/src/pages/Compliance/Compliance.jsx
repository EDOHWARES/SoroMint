/**
 * @title Compliance Dashboard
 * @notice Full-featured dashboard for monitoring and operating the SoroMint
 *         Compliance contract — blacklist entries, clawback audit records,
 *         and contract configuration.
 *
 * The Compliance contract (docs/compliance.md) lets administrators manage a
 * blacklist of addresses that are prohibited from interacting with token
 * functions, and clawback admins can burn tokens from an address while writing
 * an on-chain audit record.
 *
 * Layout (responsive):
 *   ┌────────────────────────────────────────────────────┐
 *   │  Page header + Compliance badge + refresh           │
 *   ├────────────┬────────────┬────────────┬──────────────┤
 *   │  Blacklist │  Clawback  │  Events    │ Jurisdiction │
 *   ├────────────┴────────────┴────────────┴──────────────┤
 *   │  Contract configuration (admin / clawback admin /   │
 *   │  token / default jurisdiction)                      │
 *   ├─────────────────────────────────────────────────────┤
 *   │  Blacklisted addresses table                        │
 *   ├─────────────────────────────────────────────────────┤
 *   │  Clawback audit records table                       │
 *   └─────────────────────────────────────────────────────┘
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  ShieldCheck,
  RefreshCw,
  Ban,
  Scale,
  Activity,
  Globe,
  AlertTriangle,
  UserX,
  Wallet,
  Search,
  Copy,
} from 'lucide-react';

import SEO from '../../components/SEO';
import {
  getComplianceStatus,
  getBlacklist,
  getClawbacks,
  formatBlacklistEntry,
  formatClawbackRecord,
} from '../../services/complianceService';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONTRACT_ID = 'CCOMPL000000000000000000000000000000000LIANCE';

// ─── Demo data used when backend endpoints are not deployed ──────────────────

const DEMO_STATUS = {
  blacklistCount: 3,
  clawbackCount: 2,
  eventCount: 27,
  jurisdiction: 'US',
  admin: 'GADMINXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXMIN',
  clawbackAdmin: 'GCLAWBACKXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXBACK',
  tokenAddress: 'CSMTTOKENXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXKEN',
  contractVersion: 'v1.1.0',
};

const DEMO_BLACKLIST = [
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
  {
    address: 'GBADD03XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX03',
    banned: true,
    reason: 'Court order',
    updatedAt: '2026-08-10T11:00:00Z',
  },
];

const DEMO_CLAWBACKS = [
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * @notice Truncate a Stellar G/C-address to "GBAB…WXYZ" form.
 */
const truncateId = (id) => {
  if (!id || id === '—') return '—';
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
};

/**
 * @notice Format a date string to a locale-friendly display.
 */
const formatDate = (isoString) => {
  if (!isoString || isoString === '—') return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

/**
 * @notice Copy text to clipboard with a toast confirmation.
 */
const copyToClipboard = async (text, t) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t('compliance.copied') || 'Address copied to clipboard');
  } catch {
    toast.error(t('compliance.copyFailed') || 'Failed to copy address');
  }
};

// ─── Sub-component: Compliance badge ─────────────────────────────────────────

function ComplianceBadge() {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/30 dark:text-emerald-400"
      data-testid="compliance-badge"
    >
      <ShieldCheck size={14} />
      {t('compliance.badge') || 'Blacklist & Clawback'}
    </span>
  );
}

// ─── Sub-component: Metric card ──────────────────────────────────────────────

function MetricCard({ label, value, icon: Icon, color, isLoading }) {
  return (
    <div
      className="glass-card flex flex-col gap-3 !p-5"
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-xl ${color}`}
        >
          <Icon size={16} className="text-white" />
        </div>
      </div>
      {isLoading ? (
        <div className="h-7 w-20 animate-pulse rounded-lg bg-black/8 dark:bg-white/10" />
      ) : (
        <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
          {value}
        </p>
      )}
    </div>
  );
}

// ─── Sub-component: Config row ───────────────────────────────────────────────

function ConfigRow({ label, value, isMono, testId }) {
  const { t } = useTranslation();
  if (!value || value === '—') return null;
  return (
    <div className="flex items-center justify-between gap-3 py-2" data-testid={testId}>
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className="flex items-center gap-2">
        <span
          className={`max-w-[220px] truncate text-sm font-medium text-slate-900 dark:text-white ${
            isMono ? 'font-mono text-stellar-blue' : ''
          }`}
        >
          {isMono ? truncateId(value) : value}
        </span>
        {isMono && (
          <button
            type="button"
            onClick={() => copyToClipboard(value, t)}
            className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
            aria-label={`${t('compliance.copy') || 'Copy'} ${label}`}
            data-testid={`copy-${testId}`}
          >
            <Copy size={14} />
          </button>
        )}
      </span>
    </div>
  );
}

// ─── Sub-component: Contract config card ─────────────────────────────────────

function ConfigCard({ status }) {
  const { t } = useTranslation();
  return (
    <div className="glass-card !p-5" data-testid="config-card">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
        <Wallet size={18} className="text-stellar-blue" />
        {t('compliance.configTitle') || 'Contract Configuration'}
      </h2>
      <div className="divide-y divide-black/5 dark:divide-white/5">
        <ConfigRow
          label={t('compliance.admin') || 'Admin'}
          value={status?.admin}
          isMono
          testId="config-admin"
        />
        <ConfigRow
          label={t('compliance.clawbackAdmin') || 'Clawback Admin'}
          value={status?.clawbackAdmin}
          isMono
          testId="config-clawback-admin"
        />
        <ConfigRow
          label={t('compliance.tokenAddress') || 'Token Contract'}
          value={status?.tokenAddress}
          isMono
          testId="config-token"
        />
        <ConfigRow
          label={t('compliance.defaultJurisdiction') || 'Default Jurisdiction'}
          value={status?.jurisdiction}
          testId="config-jurisdiction"
        />
      </div>
    </div>
  );
}

// ─── Sub-component: Blacklist table ──────────────────────────────────────────

function BlacklistTable({ entries, isLoading }) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="glass-card" data-testid="blacklist-loading">
        <div className="space-y-4 !p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-5 w-48 animate-pulse rounded bg-black/8 dark:bg-white/10" />
              <div className="h-5 w-28 animate-pulse rounded bg-black/8 dark:bg-white/10" />
              <div className="h-5 w-40 animate-pulse rounded bg-black/8 dark:bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div
        className="glass-card flex min-h-[200px] flex-col items-center justify-center !p-5"
        data-testid="blacklist-empty"
      >
        <Search size={40} className="mb-3 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('compliance.noBlacklist') || 'No blacklisted addresses'}
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card !p-0 overflow-hidden" data-testid="blacklist-table">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-black/5 dark:border-white/10 text-sm text-slate-500 dark:text-slate-400">
              <th className="px-5 pb-3 pt-4 font-medium">
                {t('compliance.colAddress') || 'Address'}
              </th>
              <th className="px-5 pb-3 pt-4 font-medium">
                {t('compliance.colStatus') || 'Status'}
              </th>
              <th className="px-5 pb-3 pt-4 font-medium">
                {t('compliance.colReason') || 'Reason'}
              </th>
              <th className="px-5 pb-3 pt-4 font-medium">
                {t('compliance.colUpdated') || 'Updated'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {entries.map((entry, idx) => (
              <tr
                key={entry.id || entry.address || idx}
                className="group transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                data-testid={`blacklist-row-${idx}`}
              >
                <td className="px-5 py-3 font-mono text-sm text-stellar-blue">
                  {truncateId(entry.address)}
                </td>
                <td className="px-5 py-3">
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    <UserX size={12} />
                    {entry.banned
                      ? t('compliance.bannedStatus') || 'Banned'
                      : t('compliance.allowedStatus') || 'Allowed'}
                  </span>
                </td>
                <td className="max-w-[220px] truncate px-5 py-3 text-sm text-slate-500 dark:text-slate-400">
                  {entry.reason || '—'}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-500 dark:text-slate-400">
                  {formatDate(entry.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sub-component: Clawback table ───────────────────────────────────────────

function ClawbackTable({ records, isLoading }) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="glass-card" data-testid="clawbacks-loading">
        <div className="space-y-4 !p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-5 w-16 animate-pulse rounded bg-black/8 dark:bg-white/10" />
              <div className="h-5 w-48 animate-pulse rounded bg-black/8 dark:bg-white/10" />
              <div className="h-5 w-24 animate-pulse rounded bg-black/8 dark:bg-white/10" />
              <div className="h-5 w-28 animate-pulse rounded bg-black/8 dark:bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div
        className="glass-card flex min-h-[200px] flex-col items-center justify-center !p-5"
        data-testid="clawbacks-empty"
      >
        <Scale size={40} className="mb-3 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('compliance.noClawbacks') || 'No clawback records yet'}
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card !p-0 overflow-hidden" data-testid="clawbacks-table">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-black/5 dark:border-white/10 text-sm text-slate-500 dark:text-slate-400">
              <th className="px-5 pb-3 pt-4 font-medium">#</th>
              <th className="px-5 pb-3 pt-4 font-medium">
                {t('compliance.colSource') || 'Source Address'}
              </th>
              <th className="px-5 pb-3 pt-4 font-medium">
                {t('compliance.colAmount') || 'Amount'}
              </th>
              <th className="px-5 pb-3 pt-4 font-medium">
                {t('compliance.colReason') || 'Reason'}
              </th>
              <th className="px-5 pb-3 pt-4 font-medium">
                {t('compliance.colJurisdiction') || 'Jurisdiction'}
              </th>
              <th className="px-5 pb-3 pt-4 font-medium">
                {t('compliance.colDate') || 'Date'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {records.map((record, idx) => (
              <tr
                key={record.id || record.source || idx}
                className="group transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                data-testid={`clawback-row-${idx}`}
              >
                <td className="px-5 py-3 text-sm font-medium text-slate-500 dark:text-slate-400">
                  {record.id ?? idx + 1}
                </td>
                <td className="px-5 py-3 font-mono text-sm text-stellar-blue">
                  {truncateId(record.source)}
                </td>
                <td className="px-5 py-3 font-semibold tabular-nums text-slate-900 dark:text-white">
                  {record.amount != null ? Number(record.amount).toLocaleString() : '—'}
                </td>
                <td className="max-w-[180px] truncate px-5 py-3 text-sm text-slate-500 dark:text-slate-400">
                  {record.reason || '—'}
                </td>
                <td className="px-5 py-3 text-sm text-slate-500 dark:text-slate-400">
                  {record.jurisdiction || '—'}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-sm text-slate-500 dark:text-slate-400">
                  {formatDate(record.timestamp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Compliance Dashboard Component ─────────────────────────────────────

function ComplianceDashboard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [blacklist, setBlacklist] = useState([]);
  const [clawbacks, setClawbacks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDemo, setIsDemo] = useState(false);

  // ─── Data fetching ─────────────────────────────────────────────────────────

  const fetchAll = useCallback(
    async (showToast = false) => {
      setIsLoading(true);
      setError(null);
      try {
        const [statusData, blacklistData, clawbackData] = await Promise.all([
          getComplianceStatus(null, DEMO_STATUS),
          getBlacklist(null, DEMO_BLACKLIST),
          getClawbacks(null, DEMO_CLAWBACKS),
        ]);

        setStatus(statusData);
        setBlacklist(blacklistData.map(formatBlacklistEntry));
        setClawbacks(clawbackData.map(formatClawbackRecord));

        // Demo detection: fallback data is returned when backend is not deployed
        const usedDemo =
          statusData === DEMO_STATUS ||
          blacklistData === DEMO_BLACKLIST ||
          clawbackData === DEMO_CLAWBACKS;
        setIsDemo(usedDemo);
        if (usedDemo && showToast) {
          toast.info(t('compliance.demoMode') || 'Running in demo mode — using mock data');
        }
      } catch (err) {
        setError(err.message);
        if (showToast) {
          toast.error(
            `${t('compliance.fetchError') || 'Failed to load compliance data'}: ${err.message}`
          );
        }
      } finally {
        setIsLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    fetchAll(true);
  }, [fetchAll]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <SEO title={t('compliance.pageTitle') || 'Compliance'} />

      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {t('compliance.pageTitle') || 'Compliance'}
            </h1>
            <ComplianceBadge />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('compliance.pageSubtitle') ||
              'Blacklist management and clawback audit records for token compliance'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchAll(true)}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          data-testid="refresh-btn"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          {t('compliance.refreshButton') || 'Refresh'}
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
            {t('compliance.demoHint') ||
              'Running in demo mode — backend API not connected. Showing mock data.'}
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
          label={t('compliance.metrics.blacklisted') || 'Blacklisted'}
          value={isLoading ? '—' : (status?.blacklistCount ?? blacklist.length).toLocaleString()}
          icon={Ban}
          color="bg-red-500"
          isLoading={isLoading}
        />
        <MetricCard
          label={t('compliance.metrics.clawbacks') || 'Clawbacks'}
          value={isLoading ? '—' : (status?.clawbackCount ?? clawbacks.length).toLocaleString()}
          icon={Scale}
          color="bg-stellar-blue"
          isLoading={isLoading}
        />
        <MetricCard
          label={t('compliance.metrics.events') || 'Compliance Events'}
          value={isLoading ? '—' : (status?.eventCount ?? 0).toLocaleString()}
          icon={Activity}
          color="bg-violet-500"
          isLoading={isLoading}
        />
        <MetricCard
          label={t('compliance.metrics.jurisdiction') || 'Jurisdiction'}
          value={isLoading ? '—' : status?.jurisdiction || '—'}
          icon={Globe}
          color="bg-amber-500"
          isLoading={isLoading}
        />
      </div>

      {/* Contract configuration */}
      <div className="mb-6">
        <ConfigCard status={status} />
      </div>

      {/* Blacklist table */}
      <div className="mb-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
          <Ban size={18} className="text-red-500" />
          {t('compliance.blacklistTitle') || 'Blacklisted Addresses'}
        </h2>
        <BlacklistTable entries={blacklist} isLoading={isLoading} />
      </div>

      {/* Clawback records table */}
      <div>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
          <Scale size={18} className="text-stellar-blue" />
          {t('compliance.clawbacksTitle') || 'Clawback Audit Records'}
        </h2>
        <ClawbackTable records={clawbacks} isLoading={isLoading} />
      </div>
    </>
  );
}

export default ComplianceDashboard;