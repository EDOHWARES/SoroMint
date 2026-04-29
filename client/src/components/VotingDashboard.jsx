import React, { useState, useEffect, useCallback } from 'react';
import {
  Vote,
  Plus,
  Loader2,
  BarChart3,
  Users,
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  Flame,
  Clock4,
  CheckCheck,
  List,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { listProposals, getMyVotingPower } from '../services/votingService';
import ProposalCard from './ProposalCard';
import CreateProposalModal from './CreateProposalModal';
import VoteModal from './VoteModal';

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  {
    id:    'all',
    label: 'All',
    Icon:  List,
    emptyHeading: 'No proposals yet',
    emptyBody:    'Be the first to create a governance proposal for this community.',
  },
  {
    id:    'active',
    label: 'Active',
    Icon:  Flame,
    emptyHeading: 'No active proposals',
    emptyBody:    'There are no open votes right now. Check back soon or create one yourself.',
  },
  {
    id:    'pending',
    label: 'Pending',
    Icon:  Clock4,
    emptyHeading: 'No pending proposals',
    emptyBody:    'Proposals that have been submitted but whose voting window has not started yet will appear here.',
  },
  {
    id:    'closed',
    label: 'Closed',
    Icon:  CheckCheck,
    emptyHeading: 'No closed proposals',
    emptyBody:    'Proposals whose voting window has ended will be archived here.',
  },
];

// ─── Helper: skeleton cards while loading ─────────────────────────────────────

function ProposalSkeleton() {
  return (
    <div className="glass-card animate-pulse space-y-4">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="h-5 flex-1 rounded-lg bg-black/8 dark:bg-white/10" />
        <div className="h-5 w-16 shrink-0 rounded-full bg-black/8 dark:bg-white/10" />
      </div>
      {/* Creator */}
      <div className="h-3 w-28 rounded bg-black/5 dark:bg-white/8" />
      {/* Description lines */}
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-black/5 dark:bg-white/8" />
        <div className="h-3 w-4/5 rounded bg-black/5 dark:bg-white/8" />
      </div>
      {/* Dates */}
      <div className="h-3 w-56 rounded bg-black/5 dark:bg-white/8" />
      {/* Stats */}
      <div className="flex gap-4">
        <div className="h-3 w-16 rounded bg-black/5 dark:bg-white/8" />
        <div className="h-3 w-24 rounded bg-black/5 dark:bg-white/8" />
      </div>
      {/* Bars */}
      <div className="space-y-2 rounded-2xl border border-black/5 dark:border-white/5 p-3">
        {[80, 55, 30].map((w, i) => (
          <div key={i}>
            <div className="mb-1 flex justify-between">
              <div className="h-3 w-12 rounded bg-black/5 dark:bg-white/8" />
              <div className="h-3 w-6 rounded bg-black/5 dark:bg-white/8" />
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-black/8 dark:bg-white/10"
                style={{ width: `${w}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      {/* Buttons */}
      <div className="flex gap-2 border-t border-black/5 dark:border-white/5 pt-3">
        <div className="h-9 flex-1 rounded-xl bg-black/8 dark:bg-white/10" />
        <div className="h-9 w-28 rounded-xl bg-black/5 dark:bg-white/8" />
      </div>
    </div>
  );
}

// ─── Helper: empty state ──────────────────────────────────────────────────────

function EmptyState({ tab, canCreate, onCreateClick }) {
  const cfg = TABS.find((t) => t.id === tab) || TABS[0];
  const Icon = cfg.Icon;

  return (
    <div className="glass-card col-span-full flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-black/5 dark:border-white/10 bg-black/3 dark:bg-white/5">
        <Icon size={28} className="text-slate-300 dark:text-slate-600" />
      </div>
      <div>
        <p className="text-base font-semibold text-slate-700 dark:text-slate-200">
          {cfg.emptyHeading}
        </p>
        <p className="mt-1 max-w-sm text-sm text-slate-400 dark:text-slate-500">
          {cfg.emptyBody}
        </p>
      </div>
      {tab === 'all' && canCreate && (
        <button
          onClick={onCreateClick}
          className="btn-primary mt-2 flex items-center gap-2"
        >
          <Plus size={16} />
          Create First Proposal
        </button>
      )}
    </div>
  );
}

// ─── Helper: error state ──────────────────────────────────────────────────────

function ErrorState({ message, onRetry }) {
  return (
    <div className="glass-card col-span-full flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20">
        <AlertCircle size={26} className="text-red-400" />
      </div>
      <div>
        <p className="text-base font-semibold text-slate-700 dark:text-slate-200">
          Failed to load proposals
        </p>
        <p className="mt-1 max-w-xs text-sm text-slate-400 dark:text-slate-500">
          {message || 'An unexpected error occurred. Please try again.'}
        </p>
      </div>
      <button
        onClick={onRetry}
        className="btn-primary flex items-center gap-2"
      >
        <RefreshCw size={15} />
        Try Again
      </button>
    </div>
  );
}

// ─── Voting Power Badge ───────────────────────────────────────────────────────

function VotingPowerBadge({ power, isLoading }) {
  if (isLoading) {
    return (
      <div className="flex animate-pulse items-center gap-2 rounded-xl border border-stellar-blue/20 bg-stellar-blue/5 px-3 py-2">
        <div className="h-3.5 w-3.5 rounded-full bg-stellar-blue/20" />
        <div className="h-3 w-20 rounded bg-stellar-blue/20" />
      </div>
    );
  }

  if (power === null) return null;

  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-stellar-blue/20 bg-stellar-blue/5 dark:bg-stellar-blue/10 px-3 py-2 text-sm"
      title="Your total on-chain voting power"
    >
      <Users size={14} className="shrink-0 text-stellar-blue" />
      <span className="font-bold tabular-nums text-stellar-blue">
        {Number(power).toLocaleString()}
      </span>
      <span className="text-slate-500 dark:text-slate-400">voting power</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function VotingDashboard({ address, authToken }) {
  // ── Core list state ────────────────────────────────────────────────────────
  const [tab, setTab]             = useState('all');
  const [proposals, setProposals] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState(null);

  // ── Voting power ───────────────────────────────────────────────────────────
  const [votingPower, setVotingPower]         = useState(null);
  const [isPowerLoading, setIsPowerLoading]   = useState(false);

  // ── Modal state ────────────────────────────────────────────────────────────
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showVoteModal, setShowVoteModal]     = useState(false);
  const [selectedProposal, setSelectedProposal] = useState(null);

  // ── Fetch proposals ────────────────────────────────────────────────────────
  const fetchProposals = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = tab !== 'all' ? { status: tab } : {};
      const { proposals: data } = await listProposals(params);
      setProposals(data);
    } catch (err) {
      setError(err.message || 'Unknown error');
      // Only toast on non-initial loads to avoid double-noise on first render.
      toast.error(`Could not load proposals: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  // ── Fetch voting power ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!address || !authToken) {
      setVotingPower(null);
      return;
    }

    let cancelled = false;
    setIsPowerLoading(true);

    getMyVotingPower(authToken)
      .then((data) => {
        if (!cancelled) setVotingPower(data?.votingPower ?? 0);
      })
      .catch(() => {
        if (!cancelled) setVotingPower(null);
      })
      .finally(() => {
        if (!cancelled) setIsPowerLoading(false);
      });

    return () => { cancelled = true; };
  }, [address, authToken]);

  // ── Modal handlers ─────────────────────────────────────────────────────────
  const handleVote = useCallback((proposal) => {
    setSelectedProposal(proposal);
    setShowVoteModal(true);
  }, []);

  const handleViewResults = useCallback((proposal) => {
    setSelectedProposal(proposal);
    setShowVoteModal(true);
  }, []);

  const handleVoteModalClose = useCallback(() => {
    setShowVoteModal(false);
    // Keep selectedProposal briefly so the closing animation doesn't flicker.
    setTimeout(() => setSelectedProposal(null), 300);
  }, []);

  const handleCreated = useCallback(
    (newProposal) => {
      // Optimistically prepend the new proposal if the current tab would show it,
      // then refresh to get server-computed fields (tally, voteCount, etc.).
      if (tab === 'all' || tab === (newProposal?.status ?? 'pending')) {
        setProposals((prev) => [newProposal, ...prev]);
      }
      fetchProposals();
    },
    [tab, fetchProposals],
  );

  const handleVoted = useCallback(() => {
    fetchProposals();
  }, [fetchProposals]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const canCreate      = Boolean(address && authToken);
  const showSkeletons  = isLoading;
  const showError      = !isLoading && Boolean(error);
  const showEmpty      = !isLoading && !error && proposals.length === 0;
  const showGrid       = !isLoading && !error && proposals.length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">

      {/* ────────────────────────────────────────────────────────────────────
          Header
      ──────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Title + subtitle */}
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-stellar-blue p-2.5 shadow-lg shadow-blue-500/25">
              <Vote className="h-6 w-6 text-white" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Governance
            </h2>
          </div>
          <p className="mt-2 ml-[52px] text-sm text-slate-500 dark:text-slate-400">
            Off-chain token-weighted polls — vote with your SoroMint holdings
          </p>
        </div>

        {/* Right-side controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Voting power badge — only shown when connected */}
          {address && (
            <VotingPowerBadge power={votingPower} isLoading={isPowerLoading} />
          )}

          {/* Refresh button */}
          <button
            onClick={fetchProposals}
            disabled={isLoading}
            aria-label="Refresh proposals"
            title="Refresh proposals"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/10 dark:border-white/10 bg-transparent text-slate-400 transition-colors hover:bg-black/5 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw
              size={15}
              className={isLoading ? 'animate-spin' : ''}
            />
          </button>

          {/* New proposal — only when authenticated */}
          {canCreate && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={18} />
              New Proposal
            </button>
          )}
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────────────
          Connect wallet nudge (unauthenticated)
      ──────────────────────────────────────────────────────────────────── */}
      {!address && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20 px-5 py-3.5">
          <ShieldCheck size={18} className="shrink-0 text-amber-500" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Connect your wallet to vote on proposals and track your voting power.
          </p>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────
          Stats bar — quick at-a-glance numbers when proposals are loaded
      ──────────────────────────────────────────────────────────────────── */}
      {!isLoading && !error && proposals.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: 'Total',
              count: proposals.length,
              color: 'text-slate-600 dark:text-slate-300',
              bg:    'bg-black/3 dark:bg-white/5',
            },
            {
              label: 'Active',
              count: proposals.filter((p) => p.status === 'active').length,
              color: 'text-green-600 dark:text-green-400',
              bg:    'bg-green-50 dark:bg-green-900/20',
            },
            {
              label: 'Pending',
              count: proposals.filter((p) => p.status === 'pending').length,
              color: 'text-amber-600 dark:text-amber-400',
              bg:    'bg-amber-50 dark:bg-amber-900/20',
            },
            {
              label: 'Closed',
              count: proposals.filter((p) => p.status === 'closed').length,
              color: 'text-slate-500 dark:text-slate-400',
              bg:    'bg-slate-50 dark:bg-slate-800/40',
            },
          ].map(({ label, count, color, bg }) => (
            <div
              key={label}
              className={`flex items-center justify-between rounded-2xl border border-black/5 dark:border-white/5 px-4 py-3 ${bg}`}
            >
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {label}
              </span>
              <span className={`text-xl font-bold tabular-nums ${color}`}>
                {count}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────
          Tab bar
      ──────────────────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Filter proposals by status"
        className="inline-flex rounded-2xl border border-black/5 bg-black/5 p-1.5 dark:border-white/10 dark:bg-slate-950/70 shadow-lg"
      >
        {TABS.map(({ id, label, Icon }) => {
          const isActive = tab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-white dark:bg-white/10 text-stellar-blue dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Icon size={14} className={isActive ? 'text-stellar-blue dark:text-white' : 'opacity-60'} />
              {label}
            </button>
          );
        })}
      </div>

      {/* ────────────────────────────────────────────────────────────────────
          Proposal grid / states
      ──────────────────────────────────────────────────────────────────── */}
      <div
        role="tabpanel"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {/* Loading skeletons */}
        {showSkeletons &&
          Array.from({ length: 6 }, (_, i) => (
            <ProposalSkeleton key={i} />
          ))}

        {/* Error state */}
        {showError && (
          <ErrorState message={error} onRetry={fetchProposals} />
        )}

        {/* Empty state */}
        {showEmpty && (
          <EmptyState
            tab={tab}
            canCreate={canCreate}
            onCreateClick={() => setShowCreateModal(true)}
          />
        )}

        {/* Proposal cards */}
        {showGrid &&
          proposals.map((proposal) => (
            <ProposalCard
              key={proposal._id || proposal.id}
              proposal={proposal}
              onVote={handleVote}
              onViewResults={handleViewResults}
            />
          ))}
      </div>

      {/* ────────────────────────────────────────────────────────────────────
          Pagination hint (non-functional placeholder for future use)
      ──────────────────────────────────────────────────────────────────── */}
      {showGrid && proposals.length >= 20 && (
        <div className="flex justify-center">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Showing first 20 proposals.{' '}
            <button
              onClick={fetchProposals}
              className="text-stellar-blue hover:underline transition-colors"
            >
              Load more
            </button>
          </p>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────
          Governance info footer strip
      ──────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-center gap-6 rounded-2xl border border-black/5 dark:border-white/5 bg-black/2 dark:bg-white/2 px-6 py-4 text-xs text-slate-400 dark:text-slate-500">
        <span className="flex items-center gap-1.5">
          <BarChart3 size={12} />
          Token-weighted voting
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck size={12} />
          Off-chain, gasless
        </span>
        <span className="flex items-center gap-1.5">
          <Users size={12} />
          One wallet, one vote per proposal
        </span>
      </div>

      {/* ────────────────────────────────────────────────────────────────────
          Modals
      ──────────────────────────────────────────────────────────────────── */}
      {showCreateModal && (
        <CreateProposalModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          token={authToken}
          onCreated={handleCreated}
        />
      )}

      {showVoteModal && selectedProposal && (
        <VoteModal
          open={showVoteModal}
          onClose={handleVoteModalClose}
          proposal={selectedProposal}
          token={authToken}
          address={address}
          onVoted={handleVoted}
        />
      )}

    </div>
  );
}
