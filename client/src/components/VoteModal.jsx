import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Vote,
  Users,
  Trophy,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  BarChart3,
  Clock,
  XCircle,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { castVote, getMyVotingPower } from '../services/votingService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

const truncateAddress = (addr) => {
  if (!addr) return 'Unknown';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
};

/**
 * Normalise the tally map — keys may be numeric strings ("0") or numbers (0).
 * Returns an array aligned with the `choices` array: [power0, power1, …]
 */
const normaliseTally = (choices, tally) => {
  return choices.map((_, idx) => {
    const val = tally?.[idx] ?? tally?.[String(idx)] ?? 0;
    return Number(val);
  });
};

// Colour classes for progress bars — one per choice index (cycled if > 10).
const BAR_COLORS = [
  'bg-stellar-blue',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-lime-500',
  'bg-orange-500',
  'bg-teal-500',
];

// ─── Status badge config (re-used from ProposalCard) ─────────────────────────

const STATUS_CONFIG = {
  active: {
    label: 'Active',
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700/40',
  },
  pending: {
    label: 'Pending',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-700/40',
  },
  closed: {
    label: 'Closed',
    className: 'bg-slate-100 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400 border border-slate-200 dark:border-slate-700/40',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-700/40',
  },
};

// ─── Sub-component: Voting Power Badge ───────────────────────────────────────

function VotingPowerBadge({ isLoading, votingPower }) {
  const noPower = !isLoading && votingPower !== null && votingPower === 0;

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-black/5 dark:border-white/10 bg-black/3 dark:bg-white/5 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stellar-blue/10">
          <Loader2 size={18} className="animate-spin text-stellar-blue" />
        </div>
        <div className="space-y-1.5">
          <div className="h-2.5 w-28 animate-pulse rounded-full bg-black/10 dark:bg-white/10" />
          <div className="h-4 w-16 animate-pulse rounded-full bg-black/10 dark:bg-white/10" />
        </div>
      </div>
    );
  }

  if (noPower) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/40">
          <AlertTriangle size={18} className="text-red-500 dark:text-red-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">
            No Voting Power
          </p>
          <p className="mt-0.5 text-xs text-red-400/80 dark:text-red-400/60">
            You have no voting power for this proposal. Acquire tokens to participate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-stellar-blue/20 dark:border-stellar-blue/30 bg-stellar-blue/5 dark:bg-stellar-blue/10 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stellar-blue/15 dark:bg-stellar-blue/20">
        <Trophy size={18} className="text-stellar-blue" />
      </div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Your Voting Power</p>
        <p className="text-xl font-bold tracking-tight text-stellar-blue">
          {votingPower !== null ? Number(votingPower).toLocaleString() : '—'}
        </p>
      </div>
    </div>
  );
}

// ─── Sub-component: Results View (read-only tally) ────────────────────────────

function ResultsView({ choices, tally, totalVotingPower, voteCount }) {
  const powers = normaliseTally(choices, tally);
  const total  = Number(totalVotingPower) || 0;

  const leadingIdx =
    powers.length > 0
      ? powers.reduce((best, p, i) => (p > powers[best] ? i : best), 0)
      : -1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          Current Results
        </p>
        <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
          <Users size={11} />
          {Number(voteCount).toLocaleString()}{' '}
          {Number(voteCount) === 1 ? 'vote' : 'votes'}
        </span>
      </div>

      {total === 0 ? (
        <p className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/3 dark:bg-white/3 px-4 py-5 text-center text-sm text-slate-400 dark:text-slate-500">
          No votes have been cast yet.
        </p>
      ) : (
        <div className="space-y-3 rounded-2xl border border-black/5 dark:border-white/5 bg-black/2 dark:bg-white/2 p-4">
          {choices.map((choice, idx) => {
            const power = powers[idx] || 0;
            const pct   = total > 0 ? Math.min(100, Math.round((power / total) * 100)) : 0;
            const isLeader = idx === leadingIdx && power > 0;

            return (
              <div key={idx}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                    {isLeader ? (
                      <Trophy size={13} className="shrink-0 text-amber-500" />
                    ) : (
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-black/5 dark:bg-white/10 text-[10px] font-bold text-slate-400">
                        {idx + 1}
                      </span>
                    )}
                    <span className="truncate font-medium">{choice}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                    <span className="text-slate-400 dark:text-slate-500">
                      {Number(power).toLocaleString()}
                    </span>
                    <span className="font-semibold text-slate-600 dark:text-slate-300">
                      {pct}%
                    </span>
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${
                      BAR_COLORS[idx % BAR_COLORS.length]
                    }`}
                    style={{ width: `${pct}%` }}
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${choice}: ${pct}%`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: Choice selector ──────────────────────────────────────────

function ChoiceSelector({ choices, selected, onChange, disabled }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
        Select your choice
      </p>
      {choices.map((choice, idx) => {
        const isSelected = selected === idx;
        return (
          <button
            key={idx}
            type="button"
            disabled={disabled}
            onClick={() => onChange(idx)}
            aria-pressed={isSelected}
            className={`group w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all duration-150 ${
              isSelected
                ? 'border-stellar-blue bg-stellar-blue/5 dark:bg-stellar-blue/10 shadow-sm shadow-stellar-blue/20'
                : 'border-black/10 dark:border-white/10 hover:border-stellar-blue/40 hover:bg-black/3 dark:hover:bg-white/5'
            } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          >
            {/* Custom radio circle */}
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                isSelected
                  ? 'border-stellar-blue bg-stellar-blue'
                  : 'border-slate-300 dark:border-slate-600 group-hover:border-stellar-blue/50'
              }`}
              aria-hidden="true"
            >
              {isSelected && (
                <span className="h-2 w-2 rounded-full bg-white" />
              )}
            </span>

            {/* Choice label */}
            <span
              className={`flex-1 text-sm font-medium transition-colors ${
                isSelected
                  ? 'text-stellar-blue'
                  : 'text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white'
              }`}
            >
              {choice}
            </span>

            {/* Checkmark on selected */}
            {isSelected && (
              <CheckCircle2
                size={17}
                className="ml-auto shrink-0 text-stellar-blue"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VoteModal({
  open,
  onClose,
  proposal,
  token,
  address,
  onVoted,
}) {
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [votingPower, setVotingPower]         = useState(null);
  const [isPowerLoading, setIsPowerLoading]   = useState(false);
  const [isSubmitting, setIsSubmitting]       = useState(false);

  // ── Fetch voting power on open ──────────────────────────────────────────────
  useEffect(() => {
    if (!open || !token) return;

    // Reset interactive state whenever the modal opens.
    setSelectedChoice(null);
    setVotingPower(null);

    setIsPowerLoading(true);
    getMyVotingPower(token, proposal?.contractId || null)
      .then((data) => setVotingPower(data?.votingPower ?? 0))
      .catch(() => setVotingPower(0))
      .finally(() => setIsPowerLoading(false));
  }, [open, token, proposal?.contractId]);

  // ── Close on Escape ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, isSubmitting, onClose]);

  // ── Early exits ─────────────────────────────────────────────────────────────
  if (!open || !proposal) return null;

  const {
    title        = 'Untitled Proposal',
    description  = '',
    status       = 'closed',
    choices      = [],
    tally        = {},
    voteCount    = 0,
    totalVotingPower = 0,
    startTime,
    endTime,
    creator      = '',
  } = proposal;

  const proposalId = proposal._id || proposal.id;
  const isActive   = status === 'active';

  const noPower   = votingPower !== null && Number(votingPower) === 0;
  const canSubmit =
    isActive &&
    selectedChoice !== null &&
    !noPower &&
    !isPowerLoading &&
    !isSubmitting;

  const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.closed;

  // ── Submit handler ──────────────────────────────────────────────────────────
  const handleCastVote = useCallback(async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      await castVote(proposalId, selectedChoice, token);

      const choiceLabel =
        choices[selectedChoice] || `Choice ${selectedChoice + 1}`;
      const powerDisplay = Number(votingPower).toLocaleString();

      toast.success(
        `Voted for "${choiceLabel}" with ${powerDisplay} voting power! ✅`,
      );

      onVoted();
      onClose();
    } catch (err) {
      // Surface the server's error message verbatim so the user gets context
      // (e.g. "You have already voted on this proposal").
      toast.error(`Vote failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    canSubmit,
    proposalId,
    selectedChoice,
    token,
    choices,
    votingPower,
    onVoted,
    onClose,
  ]);

  // ── Backdrop click ──────────────────────────────────────────────────────────
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !isSubmitting) onClose();
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vote-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="flex w-full max-w-lg flex-col max-h-[92vh] rounded-3xl border border-black/5 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-black/5 dark:border-white/10 px-6 py-4 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-stellar-blue/10">
              {isActive ? (
                <Vote size={16} className="text-stellar-blue" />
              ) : (
                <BarChart3 size={16} className="text-stellar-blue" />
              )}
            </div>
            <h2
              id="vote-modal-title"
              className="text-lg font-semibold text-slate-900 dark:text-white"
            >
              {isActive ? 'Cast Vote' : 'Proposal Results'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Status badge */}
            <span
              className={`hidden sm:inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusCfg.className}`}
            >
              {statusCfg.label}
            </span>

            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              aria-label="Close modal"
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-black/5 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-white disabled:opacity-40"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-5 px-6 py-6">

            {/* ── Proposal meta ─────────────────────────────────────────── */}
            <div>
              <h3 className="text-base font-semibold leading-snug text-slate-900 dark:text-white">
                {title}
              </h3>

              {creator && (
                <p className="mt-1 font-mono text-xs text-slate-400 dark:text-slate-500">
                  by{' '}
                  <span title={creator} className="cursor-default select-all">
                    {truncateAddress(creator)}
                  </span>
                </p>
              )}

              {description && (
                <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-3">
                  {description}
                </p>
              )}

              {/* Voting window dates */}
              {(startTime || endTime) && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                  <Clock size={11} className="shrink-0" />
                  <span>{formatDate(startTime)}</span>
                  <span className="opacity-60">→</span>
                  <span>{formatDate(endTime)}</span>
                </div>
              )}
            </div>

            {/* ── Voting power badge (active only; reader sees results header) */}
            {isActive && (
              <VotingPowerBadge
                isLoading={isPowerLoading}
                votingPower={votingPower}
              />
            )}

            {/* ── Non-active notice ─────────────────────────────────────── */}
            {!isActive && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-black/5 dark:border-white/10 bg-black/3 dark:bg-white/5 px-4 py-3">
                {status === 'cancelled' ? (
                  <XCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
                ) : (
                  <BarChart3 size={16} className="mt-0.5 shrink-0 text-slate-400" />
                )}
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {status === 'pending'
                    ? 'Voting has not started yet. Check back when this proposal becomes active.'
                    : status === 'cancelled'
                    ? 'This proposal was cancelled and voting is no longer available.'
                    : 'Voting for this proposal has ended. Results are final.'}
                </p>
              </div>
            )}

            {/* ── Choice selector (active proposals only) ───────────────── */}
            {isActive && (
              <ChoiceSelector
                choices={choices}
                selected={selectedChoice}
                onChange={setSelectedChoice}
                disabled={noPower || isPowerLoading || isSubmitting}
              />
            )}

            {/* ── Results tally (always shown) ──────────────────────────── */}
            {choices.length > 0 && (
              <ResultsView
                choices={choices}
                tally={tally}
                totalVotingPower={totalVotingPower}
                voteCount={voteCount}
              />
            )}

          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-black/5 dark:border-white/10 bg-white dark:bg-slate-900 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl border border-black/10 dark:border-white/10 px-5 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:border-black/20 dark:hover:border-white/20 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isActive ? 'Cancel' : 'Close'}
          </button>

          {isActive && (
            <button
              type="button"
              onClick={handleCastVote}
              disabled={!canSubmit}
              className="btn-primary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Casting…
                </>
              ) : (
                <>
                  <Vote size={16} />
                  Cast Vote
                  {selectedChoice !== null && choices[selectedChoice] && (
                    <span className="hidden sm:inline opacity-75">
                      — {choices[selectedChoice]}
                    </span>
                  )}
                  <ChevronRight size={14} className="opacity-60" />
                </>
              )}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
