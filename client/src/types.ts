// Shared domain types for SoroMint governance & bridge components.

export type ProposalStatus = 'active' | 'pending' | 'closed' | 'cancelled';

export interface Proposal {
  _id?: string;
  id?: string;
  title?: string;
  description?: string;
  creator?: string;
  status?: ProposalStatus;
  startTime?: string;
  endTime?: string;
  choices?: string[];
  tally?: Record<string, number>;
  voteCount?: number;
  totalVotingPower?: number;
  tags?: string[];
  discussionUrl?: string;
  contractId?: string;
}

export type BridgeDirection = 'both' | 'soroban-to-evm' | 'evm-to-soroban';

export interface BridgeRelayerStatus {
  enabled: boolean;
  configured: boolean;
  direction: BridgeDirection;
  queue: {
    pending: number;
    processing: number;
  };
  stats: {
    observed: number;
    skipped: number;
    relayed: number;
    failed: number;
    lastObservedAt: string | null;
    lastRelayedAt: string | null;
    lastError: string | null;
  };
  config?: {
    sorobanAccountId?: string;
    evmBridgeAddress?: string;
  };
}
