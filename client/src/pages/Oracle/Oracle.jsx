/**
 * @title Oracle / Price Feed Dashboard
 * @notice Full-featured UI for monitoring the SoroMint Price Oracle contract.
 *
 * The oracle aggregates price reports from a set of trusted sources and lets
 * protocols convert token amounts to USD. This dashboard surfaces:
 *
 *   - Trusted source count, tracked asset count, and USD value calculator
 *   - A price-feed table (token, price, decimals, source, last update)
 *   - Stale-price warnings and contract configuration
 *
 * Layout (responsive):
 *   ┌───────────────────────────────────────┐
 *   │  Page header + status/version pills   │
 *   ├───────────────┬───────────────────────┤
 *   │  Metrics 4-up (sources, assets,       │
 *   │  stale feeds, USD conversion)         │
 *   ├───────────────┴───────────────────────┤
 *   │  Price feed table (token, price,      │
 *   │  source, updated)                     │
 *   ├───────────────┬───────────────────────┤
 *   │  Sources card │  USD calculator       │
 *   └───────────────┴───────────────────────┘
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  LineChart,
  RefreshCw,
  Users,
  Coins,
  AlertTriangle,
  Percent,
  Wallet,
  Info,
  Copy,
  CheckCircle2,
  ArrowRightLeft,
  Clock,
} from 'lucide-react';

import SEO from '../../components/SEO';
import {
  getOracleStatus,
  formatPrice,
  formatTimestamp,
  calculateUsdValue,
} from '../../services/oracleService';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Oracle contract is a v2.0.0 price feed (see contracts/oracle). */
const DEFAULT_VERSION = '2.0.0';
const DEFAULT_CONTRACT_ID = 'CORACLEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVACLE';

/** Consider a feed stale after this many seconds without a fresh report. */
const STALE_MAX_AGE = 300;

// ─── Default demo data (used when backend endpoints are not deployed) ────────

const DEMO_SOURCES = [
  'GSRCONEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXONE',
  'GSRCTWOXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXTWO',
  'GSRCTHREXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXHREE',
];

const DEMO_PRICES = [
  {
    token: 'CTOKENXLMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXLM',
    price: 1053,
    timestamp: Math.floor(Date.now() / 1000) - 42,
    source: DEMO_SOURCES[0],
    decimals: 7,
  },
  {
    token: 'CTOKENUSDCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXSDC',
    price: 10000000,
    timestamp: Math.floor(Date.now() / 1000) - 8,
    source: DEMO_SOURCES[1],
    decimals: 7,
  },
  {
    token: 'CTOKENSORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXSOR',
    price: 87500000,
    timestamp: Math.floor(Date.now() / 1000) - 120,
    source: DEMO_SOURCES[2],
    decimals: 7,
  },
  {
    token: 'CTOKENARBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXARB',
    price: 4123000,
    timestamp: Math.floor(Date.now() / 1000) - 9000,
    source: DEMO_SOURCES[0],
    decimals: 6,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * @notice Truncate a Stellar C-address or G-address to "CABC…WXYZ" form.
 */
const truncateId = (id) => {
  if (!id || id === '—') return '—';
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
};

/**
 * @notice Is a price entry stale given its timestamp and the max age?
 */
const isStale = (entry, maxAge = STALE_MAX_AGE) => {
  if (!entry?.timestamp) return false;
  const now = Math.floor(Date.now() / 1000);
  return now - entry.timestamp > maxAge;
};

// ─── Sub-component: Status pill ───────────────────────────────────────────────

function StatusPill() {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-100 px-3 py-1 text-xs font-semibold text-green-700 dark:border-green-700/40 dark:bg-green-900/30 dark:text-green-400"
      data-testid="oracle-status-pill"
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      {t('oracle.live') || 'Live'}
    </span>
  );
}

// ─── Sub-component: Metric card ───────────────────────────────────────────────

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

// ─── Sub-component: Price feed table ──────────────────────────────────────────

function PriceFeedTable({ prices, isLoading }) {
  const { t } = useTranslation();
  return (
    <div className="glass-card">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
        <LineChart size={18} className="text-stellar-blue" />
        {t('oracle.priceFeed') || 'Price Feed'}
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="price-feed-table">
          <thead>
            <tr className="border-b border-black/5 text-xs uppercase tracking-wide text-slate-400 dark:border-white/10 dark:text-slate-500">
              <th className="px-3 py-2 font-medium">{t('oracle.colAsset') || 'Asset'}</th>
              <th className="px-3 py-2 font-medium">{t('oracle.colPrice') || 'Price (USD)'}</th>
              <th className="px-3 py-2 font-medium">{t('oracle.colSource') || 'Source'}</th>
              <th className="px-3 py-2 font-medium">{t('oracle.colUpdated') || 'Updated'}</th>
              <th className="px-3 py-2 font-medium">{t('oracle.colStatus') || 'Status'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={5} className="px-3 py-3">
                    <div className="h-4 w-full animate-pulse rounded bg-black/8 dark:bg-white/10" />
                  </td>
                </tr>
              ))
            ) : prices.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-slate-400 dark:text-slate-500"
                >
                  {t('oracle.noFeeds') || 'No price feeds reported yet.'}
                </td>
              </tr>
            ) : (
              prices.map((entry, i) => {
                const stale = isStale(entry);
                return (
                  <tr key={entry.token || i} className="hover:bg-black/2 dark:hover:bg-white/5">
                    <td className="px-3 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">
                      {truncateId(entry.token)}
                    </td>
                    <td className="px-3 py-3 font-semibold tabular-nums text-slate-900 dark:text-white">
                      ${formatPrice(entry.price, entry.decimals)}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {truncateId(entry.source)}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
                      {formatTimestamp(entry.timestamp)}
                    </td>
                    <td className="px-3 py-3">
                      {stale ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300"
                          data-testid={`stale-${i}`}
                        >
                          <Clock size={11} />
                          {t('oracle.stale') || 'Stale'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-700/40 dark:bg-green-900/20 dark:text-green-300">
                          {t('oracle.fresh') || 'Fresh'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sub-component: Config row ────────────────────────────────────────────────

function ConfigRow({ label, value, mono, copyable }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <div className="flex items-center gap-2">
        <span
          className={`text-sm font-medium text-slate-900 dark:text-white ${
            mono ? 'font-mono text-stellar-blue' : ''
          }`}
          data-testid={`config-${label.replace(/\s+/g, '-').toLowerCase()}`}
        >
          {value}
        </span>
        {copyable && value !== '—' && (
          <button
            type="button"
            onClick={onCopy}
            className="text-slate-400 transition hover:text-stellar-blue dark:text-slate-500"
            aria-label={t('oracle.copy') || 'Copy to clipboard'}
          >
            {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Sub-component: USD calculator ────────────────────────────────────────────

function UsdCalculator({ selectedPrice }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');

  const value =
    selectedPrice && amount
      ? calculateUsdValue(amount, selectedPrice.price, selectedPrice.decimals)
      : null;

  return (
    <div className="glass-card">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
        <Percent size={18} className="text-stellar-blue" />
        {t('oracle.usdCalculator') || 'USD Value Calculator'}
      </h2>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        {t('oracle.usdCalculatorHint') ||
          'USD value = amount × price ÷ 10^decimals, matching calculate_usd_value on-chain.'}
      </p>

      <label className="mb-1 block text-sm font-medium text-slate-500 dark:text-slate-400">
        {t('oracle.tokenAmountLabel') || 'Token Amount'}
      </label>
      <input
        type="number"
        min="0"
        inputMode="decimal"
        className="input-field w-full"
        placeholder="e.g. 1000"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label={t('oracle.tokenAmountLabel') || 'Token Amount'}
      />

      {selectedPrice ? (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          {t('oracle.rate', { price: formatPrice(selectedPrice.price, selectedPrice.decimals) }) ||
            `Rate: $${formatPrice(selectedPrice.price, selectedPrice.decimals)} per token`}
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          {t('oracle.selectRate') || 'Select an asset in the price feed above to use its rate.'}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-black/5 bg-black/5 px-4 py-3 dark:border-white/10 dark:bg-white/5">
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {t('oracle.usdValue') || 'USD value'}
        </span>
        <span
          className="text-xl font-bold tabular-nums text-stellar-blue"
          data-testid="usd-result"
        >
          {value === null ? '—' : `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
        </span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OracleDashboard({ contractId = DEFAULT_CONTRACT_ID }) {
  const { t } = useTranslation();

  const [sources, setSources] = useState([]);
  const [prices, setPrices] = useState([]);
  const [version, setVersion] = useState(null);
  const [selectedToken, setSelectedToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loadedWithFallback, setLoadedWithFallback] = useState(false);

  const loadStatus = useCallback(
    async (showToast = true) => {
      setIsLoading(true);
      setError(null);
      try {
        const { sources: src, prices: pr, version: ver } = await getOracleStatus(
          contractId,
          null,
          { sources: DEMO_SOURCES, prices: DEMO_PRICES, version: DEFAULT_VERSION },
        );

        // If the backend proxy is absent, the service falls back to the demo
        // payload — surface a subtle hint so users know it's demo data.
        const usedFallback = src.length === DEMO_SOURCES.length && pr.length === DEMO_PRICES.length;

        setSources(src);
        setPrices(pr);
        setVersion(ver);
        setLoadedWithFallback(usedFallback);

        // Default the calculator to the first non-stale price entry.
        const fresh = pr.find((e) => !isStale(e)) || pr[0];
        setSelectedToken(fresh?.token ?? null);

        if (showToast && usedFallback) {
          toast.info(t('oracle.demoMode') || 'Showing demo data — backend not connected.');
        }
      } catch (err) {
        setError(err.message);
        toast.error(`${t('oracle.loadFailed') || 'Failed to load oracle status'}: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    },
    [contractId, t],
  );

  useEffect(() => {
    loadStatus(false);
  }, [loadStatus]);

  const selectedPrice = prices.find((p) => p.token === selectedToken) || null;

  return (
    <>
      <SEO title={`${t('oracle.pageTitle') || 'Oracle'} | SoroMint`} path="/oracle" />

      {/* Page header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="rounded-2xl bg-stellar-blue p-3 shadow-lg shadow-blue-500/30">
            <LineChart className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              {t('oracle.pageTitle') || 'Oracle'}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t('oracle.pageSubtitle') ||
                'Price feed aggregator — trusted source price reports & USD conversion'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
            <Info size={12} />
            {t('oracle.contractVersion', { version: version || DEFAULT_VERSION }) ||
              `Contract v${version || DEFAULT_VERSION}`}
          </span>
          <button
            type="button"
            onClick={() => loadStatus()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-black/5 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
            aria-label={t('oracle.refreshButton') || 'Refresh'}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            {isLoading
              ? t('oracle.loading') || 'Loading…'
              : t('oracle.refreshButton') || 'Refresh'}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="mb-6 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300"
          role="alert"
        >
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Demo-mode hint */}
      {loadedWithFallback && !error && (
        <div
          className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300"
          data-testid="demo-hint"
        >
          <Info size={16} />
          {t('oracle.demoMode') ||
            'Showing demo data — the backend Soroban RPC proxy is not connected yet.'}
        </div>
      )}

      {/* Metrics 4-up */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={t('oracle.metrics.sources') || 'Trusted Sources'}
          value={isLoading ? '' : sources.length}
          icon={Users}
          color="bg-stellar-blue"
          isLoading={isLoading}
        />
        <MetricCard
          label={t('oracle.metrics.assets') || 'Tracked Assets'}
          value={isLoading ? '' : prices.length}
          icon={Coins}
          color="bg-emerald-500"
          isLoading={isLoading}
        />
        <MetricCard
          label={t('oracle.metrics.stale') || 'Stale Feeds'}
          value={isLoading ? '' : prices.filter((p) => isStale(p)).length}
          icon={Clock}
          color="bg-amber-500"
          isLoading={isLoading}
        />
        <MetricCard
          label={t('oracle.metrics.usd') || 'USD Converted'}
          value={
            isLoading
              ? ''
              : selectedPrice
                ? `$${formatPrice(selectedPrice.price, selectedPrice.decimals)}`
                : '—'
          }
          icon={Wallet}
          color="bg-violet-500"
          isLoading={isLoading}
        />
      </div>

      {/* Price feed table */}
      <div className="mb-8">
        <PriceFeedTable prices={prices} isLoading={isLoading} />
      </div>

      {/* Sources + calculator */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="glass-card">
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
            <Users size={18} className="text-stellar-blue" />
            {t('oracle.trustedSources') || 'Trusted Sources'}
          </h2>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            {t('oracle.trustedSourcesHint') ||
              'Only these reporter addresses may submit price updates to the oracle.'}
          </p>

          <div className="divide-y divide-black/5 dark:divide-white/5">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-5 animate-pulse rounded bg-black/8 dark:bg-white/10 py-2" />
              ))
            ) : sources.length === 0 ? (
              <p className="py-2 text-sm text-slate-400 dark:text-slate-500">
                {t('oracle.noSources') || 'No trusted sources configured.'}
              </p>
            ) : (
              sources.map((src, i) => (
                <ConfigRow
                  key={`${src}-${i}`}
                  label={`${t('oracle.source') || 'Source'} ${i + 1}`}
                  value={truncateId(src)}
                  mono
                  copyable
                />
              ))
            )}
          </div>

          <div className="mt-4 border-t border-black/5 pt-4 dark:border-white/10">
            <ConfigRow
              label={t('oracle.contractId') || 'Contract ID'}
              value={truncateId(contractId)}
              mono
              copyable
            />
            <ConfigRow
              label={t('oracle.staleAge') || 'Stale after'}
              value={`${STALE_MAX_AGE}s`}
            />
          </div>
        </div>

        <UsdCalculator selectedPrice={selectedPrice} />
      </div>

      {/* Operations note */}
      <div
        className="mt-8 flex items-start gap-3 rounded-2xl border border-black/5 bg-black/5 px-4 py-4 text-sm text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
        data-testid="ops-note"
      >
        <ArrowRightLeft size={16} className="mt-0.5 shrink-0 text-stellar-blue" />
        <p>
          {t('oracle.opsNote') ||
            'Price reports are submitted by trusted source wallets via the Soroban contract and will appear here automatically after the transaction settles.'}
        </p>
      </div>
    </>
  );
}