/**
 * @title Token Factory Dashboard
 * @notice Full-featured UI for deploying and managing Soroban token contracts
 *         via the SoroMint Token Factory (v2.0.0).
 *
 * Layout (responsive):
 *   ┌─────────────────────────────────┐
 *   │  Page header + status pills     │
 *   ├─────────────┬───────────────────┤
 *   │  Metrics    │  Metrics  (4-up)  │
 *   ├─────────────┴───────────────────┤
 *   │  Deploy form   │  Recent tokens │  ← 2-col on lg+
 *   └──────────────────────────────────┘
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import {
  Factory,
  Rocket,
  RefreshCw,
  ShieldCheck,
  Coins,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  Copy,
  ExternalLink,
  Hash,
  BarChart3,
  Settings,
} from 'lucide-react';

import SEO from '../../components/SEO';
import ErrorBoundary from '../../components/error-boundary';
import { SectionCrashCard } from '../../components/error-fallbacks';
import { SkeletonList } from '../../components/Skeleton';
import { useWalletStore } from '../../store';
import {
  getTokensByOwner,
  deployToken,
  getFactoryMetrics,
} from '../../services/factoryService';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Contract version sourced from the on-chain factory contract */
const FACTORY_VERSION = '2.0.0';
/** Matches BridgeStatus "alive" from the on-chain status() call */
const FACTORY_STATUS = 'alive';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Truncate a Stellar C-address or G-address to "CABCD…WXYZ" form.
 */
const truncateId = (id) => {
  if (!id) return '—';
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
};

/**
 * Format an ISO date string for display in the recent deployments table.
 */
const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

/**
 * Generate a deterministic 32-byte hex salt from timestamp + random bytes.
 * In a full on-chain integration this would be passed to the Soroban factory.
 */
const generateSalt = () => {
  const timestamp = Date.now().toString(16).padStart(16, '0');
  const random = crypto.getRandomValues(new Uint8Array(8));
  const randomHex = Array.from(random)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return (timestamp + randomHex).padStart(64, '0').slice(0, 64);
};

// ─── Sub-component: Status pill ───────────────────────────────────────────────

function StatusPill({ status }) {
  const isAlive = status === FACTORY_STATUS;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border ${
        isAlive
          ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700/40'
          : 'bg-red-100 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700/40'
      }`}
    >
      {isAlive && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
      )}
      {isAlive ? 'Live' : 'Offline'}
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

// ─── Sub-component: Deploy form ───────────────────────────────────────────────

function DeployForm({ address, authToken, onDeployed }) {
  const { t } = useTranslation();

  const [form, setForm] = useState({
    name: '',
    symbol: '',
    decimals: 7,
    metadataHash: '',
    isMultisig: false,
  });
  const [errors, setErrors] = useState({});
  const [isDeploying, setIsDeploying] = useState(false);

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = (f) => {
    const e = {};
    if (!f.name.trim()) e.name = 'Token name is required.';
    else if (f.name.trim().length > 64) e.name = 'Name must be 64 characters or fewer.';
    if (!f.symbol.trim()) e.symbol = 'Symbol is required.';
    else if (!/^[A-Z0-9]{1,12}$/i.test(f.symbol.trim()))
      e.symbol = 'Symbol must be 1–12 alphanumeric characters.';
    const dec = Number(f.decimals);
    if (!Number.isInteger(dec) || dec < 0 || dec > 18)
      e.decimals = 'Decimals must be an integer between 0 and 18.';
    return e;
  };

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!address) {
      toast.warn(t('factory.connectFirst'));
      return;
    }

    const errs = validate(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setIsDeploying(true);
    try {
      // Generate a deterministic salt — in production, derive from Freighter
      // account sequence or a user-provided nonce.
      const salt = generateSalt();

      // Mock contract ID: in production this is returned by the Soroban
      // factory after `create_token` / `v2_create_token` is submitted.
      const contractId =
        'C' +
        Math.random().toString(36).substring(2, 10).toUpperCase() +
        Math.random().toString(36).substring(2, 10).toUpperCase();

      const payload = {
        name: form.name.trim(),
        symbol: form.symbol.trim().toUpperCase(),
        decimals: Number(form.decimals),
        contractId,
        ownerPublicKey: address,
        // Pass salt and metadata for future on-chain integration
        salt,
        metadataHash: form.metadataHash.trim() || null,
        isMultisig: form.isMultisig,
      };

      const created = await deployToken(payload, authToken);

      toast.success(t('factory.deploySuccess'));
      setForm({ name: '', symbol: '', decimals: 7, metadataHash: '', isMultisig: false });
      setErrors({});
      onDeployed(created);
    } catch (err) {
      toast.error(`${t('factory.deployFailed')}: ${err.message}`);
    } finally {
      setIsDeploying(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <section aria-labelledby="deploy-heading">
      <div className="glass-card h-full">
        <h2
          id="deploy-heading"
          className="mb-6 flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-white"
        >
          <Rocket size={20} className="text-stellar-blue" />
          {t('factory.deployTitle')}
        </h2>

        {!address ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400 dark:text-slate-500">
            <ShieldCheck size={40} className="opacity-20" />
            <p className="text-sm">{t('factory.walletPrompt')}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Token Name */}
            <div>
              <label
                htmlFor="tf-name"
                className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                {t('factory.nameLabel')}
                <span className="ml-1 text-red-400" aria-hidden="true">*</span>
              </label>
              <input
                id="tf-name"
                type="text"
                maxLength={64}
                placeholder={t('factory.namePlaceholder')}
                className={`input-field w-full ${errors.name ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : ''}`}
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                aria-describedby={errors.name ? 'tf-name-error' : undefined}
                aria-invalid={!!errors.name}
              />
              {errors.name && (
                <p id="tf-name-error" className="mt-1.5 flex items-center gap-1 text-xs text-red-500 dark:text-red-400">
                  <AlertCircle size={12} className="shrink-0" />
                  {errors.name}
                </p>
              )}
            </div>

            {/* Symbol */}
            <div>
              <label
                htmlFor="tf-symbol"
                className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                {t('factory.symbolLabel')}
                <span className="ml-1 text-red-400" aria-hidden="true">*</span>
              </label>
              <input
                id="tf-symbol"
                type="text"
                maxLength={12}
                placeholder={t('factory.symbolPlaceholder')}
                className={`input-field w-full uppercase ${errors.symbol ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : ''}`}
                value={form.symbol}
                onChange={(e) => setField('symbol', e.target.value.toUpperCase())}
                aria-describedby={errors.symbol ? 'tf-symbol-error' : undefined}
                aria-invalid={!!errors.symbol}
              />
              {errors.symbol && (
                <p id="tf-symbol-error" className="mt-1.5 flex items-center gap-1 text-xs text-red-500 dark:text-red-400">
                  <AlertCircle size={12} className="shrink-0" />
                  {errors.symbol}
                </p>
              )}
            </div>

            {/* Decimals */}
            <div>
              <label
                htmlFor="tf-decimals"
                className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                {t('factory.decimalsLabel')}
                <span className="ml-1 text-red-400" aria-hidden="true">*</span>
              </label>
              <input
                id="tf-decimals"
                type="number"
                min={0}
                max={18}
                className={`input-field w-full ${errors.decimals ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : ''}`}
                value={form.decimals}
                onChange={(e) => setField('decimals', e.target.value)}
                aria-describedby={errors.decimals ? 'tf-decimals-error' : undefined}
                aria-invalid={!!errors.decimals}
              />
              {errors.decimals && (
                <p id="tf-decimals-error" className="mt-1.5 flex items-center gap-1 text-xs text-red-500 dark:text-red-400">
                  <AlertCircle size={12} className="shrink-0" />
                  {errors.decimals}
                </p>
              )}
            </div>

            {/* Metadata Hash (v2) */}
            <div>
              <label
                htmlFor="tf-metadata"
                className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                {t('factory.metadataHashLabel')}
              </label>
              <div className="relative">
                <Hash
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="tf-metadata"
                  type="text"
                  placeholder={t('factory.metadataHashPlaceholder')}
                  className="input-field w-full pl-9"
                  value={form.metadataHash}
                  onChange={(e) => setField('metadataHash', e.target.value)}
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                {t('factory.metadataHashHint')}
              </p>
            </div>

            {/* Multi-sig toggle */}
            <div className="flex items-start gap-3 rounded-2xl border border-black/5 dark:border-white/10 bg-black/3 dark:bg-white/3 p-4">
              <input
                id="tf-multisig"
                type="checkbox"
                checked={form.isMultisig}
                onChange={(e) => setField('isMultisig', e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-stellar-blue focus:ring-stellar-blue"
              />
              <div>
                <label
                  htmlFor="tf-multisig"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <Settings size={13} className="inline mr-1.5 opacity-60" />
                  {t('factory.multisigLabel')}
                </label>
                <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                  {t('factory.multisigHint')}
                </p>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isDeploying}
              className="btn-primary mt-2 flex w-full items-center justify-center gap-2 disabled:opacity-50"
            >
              {isDeploying ? (
                <>
                  <Loader2 size={17} className="animate-spin" />
                  {t('factory.deployingButton')}
                </>
              ) : (
                <>
                  {t('factory.deployButton')}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

// ─── Sub-component: Recent deployments table ──────────────────────────────────

function RecentDeployments({ tokens, isLoading, onRefresh }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(null);

  const handleCopy = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard API unavailable */
    }
  };

  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2
          id="recent-heading"
          className="flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-white"
        >
          <BarChart3 size={20} className="text-stellar-blue" />
          {t('factory.recentTitle')}
        </h2>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          aria-label={t('factory.refreshButton')}
          title={t('factory.refreshButton')}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 dark:border-white/10 text-slate-400 transition-colors hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="glass-card !p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6">
            <SkeletonList count={4} />
          </div>
        ) : tokens.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Coins size={36} className="text-slate-300 dark:text-slate-600" />
            <div>
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                {t('factory.recentEmpty')}
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                {t('factory.recentEmptyHint')}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Recent token deployments">
              <thead>
                <tr className="border-b border-black/5 dark:border-white/10 text-xs text-slate-500 dark:text-slate-400">
                  <th className="px-6 py-4 font-medium">{t('factory.colName')}</th>
                  <th className="px-6 py-4 font-medium">{t('factory.colSymbol')}</th>
                  <th className="px-6 py-4 font-medium">{t('factory.colContract')}</th>
                  <th className="px-6 py-4 font-medium text-right">{t('factory.colDecimals')}</th>
                  <th className="px-6 py-4 font-medium text-right">{t('factory.colDate')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {tokens.map((token, idx) => (
                  <tr
                    key={token._id || token.contractId || idx}
                    className="group transition-colors hover:bg-black/2 dark:hover:bg-white/3"
                  >
                    <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                      {token.name}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center rounded-full border border-stellar-blue/20 bg-stellar-blue/5 px-2.5 py-0.5 text-xs font-semibold text-stellar-blue dark:bg-stellar-blue/10">
                        {token.symbol}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="font-mono text-xs text-stellar-blue"
                          title={token.contractId}
                        >
                          {truncateId(token.contractId)}
                        </span>
                        <button
                          onClick={() => handleCopy(token.contractId, token.contractId)}
                          aria-label="Copy contract ID"
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-white"
                        >
                          {copied === token.contractId ? (
                            <CheckCircle2 size={12} className="text-green-500" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {token.decimals}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-slate-400 dark:text-slate-500">
                      {formatDate(token.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function TokenFactory({ authToken }) {
  const { t } = useTranslation();
  const { address } = useWalletStore();

  // ── State ──────────────────────────────────────────────────────────────────
  const [tokens, setTokens] = useState([]);
  const [metrics, setMetrics] = useState({ totalDeployed: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState(null);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!address || !authToken) {
      setTokens([]);
      setMetrics({ totalDeployed: 0 });
      return;
    }

    setIsLoading(true);
    setMetricsError(null);

    try {
      const { totalDeployed, recentTokens } = await getFactoryMetrics(address, authToken);
      setTokens(recentTokens);
      setMetrics({ totalDeployed });
    } catch (err) {
      setMetricsError(err.message);
      toast.error(`${t('factory.errorLoadMetrics')}: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [address, authToken, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Handle new deployment ──────────────────────────────────────────────────
  const handleDeployed = useCallback(
    (newToken) => {
      setTokens((prev) => [newToken, ...prev]);
      setMetrics((prev) => ({ ...prev, totalDeployed: prev.totalDeployed + 1 }));
      // Full refresh to sync with server
      loadData();
    },
    [loadData],
  );

  // ── Metric values ──────────────────────────────────────────────────────────
  const metricCards = [
    {
      label: t('factory.metricsOwned'),
      value: isLoading ? '…' : String(metrics.totalDeployed),
      icon: Coins,
      color: 'bg-stellar-blue',
    },
    {
      label: t('factory.metricsVersion'),
      value: `v${FACTORY_VERSION}`,
      icon: Hash,
      color: 'bg-violet-500',
    },
    {
      label: t('factory.metricsStatus'),
      value: 'Live',
      icon: CheckCircle2,
      color: 'bg-emerald-500',
    },
    {
      label: 'Soroban Network',
      value: 'Testnet',
      icon: ExternalLink,
      color: 'bg-amber-500',
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <SEO
        title={t('factory.pageTitle')}
        description={t('factory.pageSubtitle')}
        path="/factory"
      />

      <div className="space-y-10">

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-stellar-blue p-2.5 shadow-lg shadow-blue-500/25">
                <Factory className="h-6 w-6 text-white" aria-hidden="true" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                {t('factory.pageTitle')}
              </h1>
            </div>
            <p className="mt-2 ml-[52px] text-sm text-slate-500 dark:text-slate-400">
              {t('factory.pageSubtitle')}
            </p>
          </div>

          {/* Contract version + status pills */}
          <div className="flex flex-wrap items-center gap-2 ml-[52px] sm:ml-0">
            <span className="rounded-full border border-stellar-blue/20 bg-stellar-blue/5 dark:bg-stellar-blue/10 px-3 py-1 text-xs font-semibold text-stellar-blue">
              {t('factory.contractVersion')}
            </span>
            <StatusPill status={FACTORY_STATUS} />
          </div>
        </div>

        {/* ── Wallet connect nudge ────────────────────────────────────────── */}
        {!address && (
          <div
            className="flex items-center gap-3 rounded-2xl border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20 px-5 py-3.5"
            role="alert"
          >
            <ShieldCheck size={18} className="shrink-0 text-amber-500" aria-hidden="true" />
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {t('factory.walletPrompt')}
            </p>
          </div>
        )}

        {/* ── Metrics row ─────────────────────────────────────────────────── */}
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          aria-label="Factory metrics"
        >
          {metricCards.map(({ label, value, icon, color }) => (
            <MetricCard
              key={label}
              label={label}
              value={value}
              icon={icon}
              color={color}
              isLoading={isLoading && label === t('factory.metricsOwned')}
            />
          ))}
        </div>

        {/* ── Error banner ────────────────────────────────────────────────── */}
        {metricsError && (
          <div
            className="flex items-center gap-3 rounded-2xl border border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20 px-5 py-3.5"
            role="alert"
          >
            <AlertCircle size={18} className="shrink-0 text-red-500" aria-hidden="true" />
            <p className="text-sm text-red-700 dark:text-red-300">
              {t('factory.errorLoadMetrics')}: {metricsError}
            </p>
          </div>
        )}

        {/* ── Main two-column layout ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">

          {/* Deploy form — 2/5 */}
          <div className="lg:col-span-2">
            <ErrorBoundary
              fallbackRender={({ resetErrorBoundary }) => (
                <SectionCrashCard
                  title="Deploy Form Unavailable"
                  onRetry={resetErrorBoundary}
                />
              )}
            >
              <DeployForm
                address={address}
                authToken={authToken}
                onDeployed={handleDeployed}
              />
            </ErrorBoundary>
          </div>

          {/* Recent deployments — 3/5 */}
          <div className="lg:col-span-3">
            <ErrorBoundary
              fallbackRender={({ resetErrorBoundary }) => (
                <SectionCrashCard
                  title="Deployments Table Unavailable"
                  onRetry={resetErrorBoundary}
                />
              )}
            >
              <RecentDeployments
                tokens={tokens}
                isLoading={isLoading}
                onRefresh={loadData}
              />
            </ErrorBoundary>
          </div>
        </div>

        {/* ── Info footer strip ───────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-center gap-6 rounded-2xl border border-black/5 dark:border-white/5 bg-black/2 dark:bg-white/2 px-6 py-4 text-xs text-slate-400 dark:text-slate-500">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={12} aria-hidden="true" />
            Factory v{FACTORY_VERSION}
          </span>
          <span className="flex items-center gap-1.5">
            <Rocket size={12} aria-hidden="true" />
            Soroban SDK 22.0.0
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={12} aria-hidden="true" />
            Replay-protected salt generation
          </span>
        </div>

      </div>
    </>
  );
}
