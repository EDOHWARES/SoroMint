import React from 'react';
import {
  Clock,
  Users,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Trophy,
  Tag,
  Link,
} from 'lucide-react';

// ─── Status configuration ────────────────────────────────────────────────────

const STATUS_CONFIG = {
  active: {
    label: 'Active',
    className:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700/40',
    pulse: true,
  },
  pending: {
    label: 'Pending',
    className:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-700/40',
    pulse: false,
  },
  closed: {
    label: 'Closed',
    className:
      'bg-slate-100 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400 border border-slate-200 dark:border-slate-700/40',
    pulse: false,
  },
  cancelled: {
    label: 'Cancelled',
    className:
      'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-700/40',
    pulse: false,
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format an ISO date string into a human-readable short form.
 * e.g. "Jun 12, 2025, 09:00 AM"
 */
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

/**
 * Truncate a Stellar G-address to "GABCD…WXYZ" form.
 */
const truncateAddress = (addr) => {
  if (!addr) return 'Unknown';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
};

/**
 * Build a normalised array of { label, power, pct } objects from the
 * proposal's tally map and choices list.
 *
 * The tally object coming from the API may use either numeric string keys
 * ("0", "1", …) or numeric keys depending on serialisation — we handle both.
 */
const buildChoiceBars = (choices, tally, totalVotingPower) => {
  return choices.map((label, idx) => {
    const power =
      (tally && (tally[idx] ?? tally[String(idx)] ?? 0)) || 0;
    const pct =
      totalVotingPower > 0
        ? Math.min(100, Math.round((power / totalVotingPower) * 100))
        : 0;
    return { label, power, pct };
  });
};

// Tailwind colour classes for the first several choices so bars are distinct.
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

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProposalCard({ proposal, onVote, onViewResults }) {
  const {
    title = 'Untitled Proposal',
    description = '',
    creator = '',
    status = 'closed',
    startTime,
    endTime,
    choices = [],
    tally = {},
    voteCount = 0,
    totalVotingPower = 0,
    tags = [],
    discussionUrl = '',
  } = proposal;

  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.closed;
  const hasVotes = Number(totalVotingPower) > 0;
  const choiceBars = hasVotes
    ? buildChoiceBars(choices, tally, Number(totalVotingPower))
    : [];

  // Find the leading choice (highest power) for the "winner" crown indicator.
  const leadingIdx =
    hasVotes && choiceBars.length > 0
      ? choiceBars.reduce(
          (best, bar, idx) => (bar.power > choiceBars[best].power ? idx : best),
          0,
        )
      : -1;

  return (
    <div className="glass-card flex flex-col gap-4">
      {/* ── Title & status badge ────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex-1 text-base font-semibold leading-snug text-slate-900 dark:text-white line-clamp-2">
          {title}
        </h3>

        {/* Status badge */}
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${cfg.className}`}
        >
          {cfg.pulse ? (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
          ) : null}
          {cfg.label}
        </span>
      </div>

      {/* ── Creator ─────────────────────────────────────────────── */}
      <p className="-mt-2 font-mono text-xs text-slate-400 dark:text-slate-500">
        by{' '}
        <span
          title={creator}
          className="cursor-default select-all hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          {truncateAddress(creator)}
        </span>
      </p>

      {/* ── Description ─────────────────────────────────────────── */}
      {description ? (
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300 line-clamp-2">
          {description}
        </p>
      ) : null}

      {/* ── Voting window ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
        <Clock size={12} className="shrink-0" />
        <span>{formatDate(startTime)}</span>
        <span className="mx-0.5 opacity-60">→</span>
        <span>{formatDate(endTime)}</span>
      </div>

      {/* ── Stats row ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1">
          <Users size={12} />
          <span>
            {Number(voteCount).toLocaleString()}{' '}
            {Number(voteCount) === 1 ? 'vote' : 'votes'}
          </span>
        </div>
        {hasVotes && (
          <div className="flex items-center gap-1">
            <BarChart3 size={12} />
            <span>{Number(totalVotingPower).toLocaleString()} total power</span>
          </div>
        )}
      </div>

      {/* ── Tally progress bars ─────────────────────────────────── */}
      {hasVotes && choiceBars.length > 0 ? (
        <div className="space-y-2.5 rounded-2xl border border-black/5 dark:border-white/5 bg-black/2 dark:bg-white/2 p-3">
          {choiceBars.map((bar, idx) => (
            <div key={idx}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  {/* Crown on leading choice when proposal is closed/settled */}
                  {idx === leadingIdx && (status === 'closed' || status === 'cancelled') ? (
                    <Trophy
                      size={11}
                      className="shrink-0 text-amber-500"
                      aria-label="Leading choice"
                    />
                  ) : (
                    <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-black/5 dark:bg-white/10 text-[9px] font-bold text-slate-500 dark:text-slate-400">
                      {idx + 1}
                    </span>
                  )}
                  <span className="truncate">{bar.label}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                  {bar.pct}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${
                    BAR_COLORS[idx % BAR_COLORS.length]
                  }`}
                  style={{ width: `${bar.pct}%` }}
                  role="progressbar"
                  aria-valuenow={bar.pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${bar.label}: ${bar.pct}%`}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Tags ────────────────────────────────────────────────── */}
      {tags && tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag size={11} className="shrink-0 text-slate-400 dark:text-slate-500" />
          {tags.slice(0, 5).map((tag, idx) => (
            <span
              key={idx}
              className="rounded-full border border-black/5 dark:border-white/10 bg-black/5 dark:bg-white/5 px-2 py-0.5 text-[11px] text-slate-500 dark:text-slate-400"
            >
              {tag}
            </span>
          ))}
          {tags.length > 5 ? (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              +{tags.length - 5} more
            </span>
          ) : null}
        </div>
      ) : null}

      {/* ── Discussion link ─────────────────────────────────────── */}
      {discussionUrl ? (
        <a
          href={discussionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-stellar-blue hover:text-blue-600 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <Link size={11} />
          <span className="truncate">Discussion</span>
          <ChevronRight size={11} className="opacity-60" />
        </a>
      ) : null}

      {/* ── Action buttons ──────────────────────────────────────── */}
      <div className="mt-auto flex items-center gap-2 border-t border-black/5 dark:border-white/5 pt-3">
        {status === 'active' ? (
          <button
            onClick={() => onVote(proposal)}
            className="btn-primary flex flex-1 items-center justify-center gap-1.5 py-2 text-sm"
          >
            <CheckCircle2 size={15} />
            Vote Now
          </button>
        ) : null}

        <button
          onClick={() => onViewResults(proposal)}
          className={`flex items-center justify-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-black/20 dark:hover:border-white/20 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white ${
            status === 'active' ? '' : 'flex-1'
          }`}
        >
          <BarChart3 size={15} />
          {status === 'closed' ? 'View Results' : 'Results'}
          <ChevronRight size={13} className="ml-auto opacity-50" />
        </button>
      </div>
    </div>
  );
}
