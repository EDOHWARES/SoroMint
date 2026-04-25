# Private Streaming Roadmap

This document records the research and implementation roadmap for privacy-preserving stream amounts in the Soroban streaming contract. The current contract changes are an explicit stub: they store commitments for future proof systems, but they do not provide production confidentiality or zero-knowledge verification.

## Current State

The standard streaming contract is public and amount-based:

- `create_stream` accepts `total_amount`, transfers that exact amount into the contract, and stores a public `rate_per_ledger`.
- `withdraw` accepts and emits public withdrawal amounts, and stores public `withdrawn` totals.
- Sender, recipient, token, start ledger, stop ledger, stream IDs, balances, and events are visible to chain observers.
- Token transfers still reveal token movement through the token contract and ledger metadata.

This is appropriate for transparent payroll, subscriptions, vesting, and accounting flows, but it is not private streaming.

## Soroban ZK Capability Investigation

As of 2026-04-25, Soroban/Stellar privacy tooling is still emerging and should be treated as roadmap work for this repository.

Current usable or near-term approaches center on Groth16 verifiers deployed on Soroban and backed by native curve host functions. Public examples have emphasized BLS12-381 Groth16 verification. Newer or upcoming Stellar protocol material discusses BN254 and Poseidon/Poseidon2 host functions around Protocol 25/26, but exact network availability and SDK support must be verified before this project adopts those APIs.

Privacy Pools-style examples are relevant because they combine:

- Commitments to private notes or balances.
- Merkle inclusion proofs against known roots.
- Nullifiers to prevent double-spend, double-withdraw, or replay.
- Groth16 verification over public inputs such as roots, nullifier hashes, and commitments.

Confidential token standards and shielded asset flows are also still in progress. Until those mature, a streaming contract can store commitments and verify proofs, but ordinary token transfers can still leak amounts and relationships.

## Proposed Private Stream Design

A production design should include these components before any private value movement is enabled:

1. **Commitments**
   - Store commitments for total amount, rate, withdrawn amount, or encrypted stream notes.
   - Treat commitments as binding public inputs, not as privacy by themselves.

2. **Nullifiers**
   - Track nullifier hashes for withdrawals, cancellations, and note spends.
   - Reject reused nullifiers to prevent replay and double-withdrawals.

3. **Merkle roots**
   - Maintain accepted roots for stream notes, pool membership, or deposit commitments.
   - Verify proofs against recent valid roots with clear root expiration rules.

4. **Generated Groth16 verifier contract**
   - Generate the verifier from audited circuits and proving keys.
   - Use Soroban host functions that are available in the target protocol and `soroban-sdk` version.
   - Keep verifier addresses explicit and upgrade paths controlled.

5. **Client-side proof generation**
   - Generate witnesses and proofs off-chain.
   - Submit only commitments, nullifiers, roots, and verifier public inputs on-chain.

6. **Optional view or audit key**
   - Support voluntary disclosure, compliance reporting, payroll auditability, or dispute resolution without making all streams public.

## Phased Roadmap

### Phase 0: Contract Stub

Implemented by this issue:

- Add `PrivateStreamStub` storage with amount, rate, and withdrawn commitments.
- Add `create_private_stream_stub` without token transfer or raw amount input.
- Add `get_private_stream_stub` for transparent inspection of placeholder state.
- Add `verify_private_stream_proof_stub`, which intentionally returns `false` and must not gate value movement.

### Phase 1: Off-chain Circuit and Prover Design

- Define stream note format, commitment scheme, nullifier derivation, and public inputs.
- Build circuits for stream creation, withdrawal eligibility, cancellation, and optional disclosure.
- Select hash functions and curves based on audited implementations and live Soroban host support.
- Produce local prover tests and deterministic test vectors.

### Phase 2: On-chain Verifier Integration

- Generate and deploy a Groth16 verifier contract compatible with the target network.
- Replace the stub verifier path with calls to the generated verifier.
- Add tests that use known-valid and known-invalid proofs.
- Keep raw amount inputs out of the private path.

### Phase 3: Private Withdrawals and Cancellations

- Add nullifier storage and replay protection.
- Add accepted Merkle root tracking.
- Implement proof-gated withdrawal and cancellation flows.
- Define refund behavior without revealing streamed or unstreamed amounts beyond required public inputs.

### Phase 4: Compliance, Audit, and Product Integration

- Add optional view-key or audit-key support.
- Integrate proof generation into frontend/backend workflows.
- Add operational monitoring for verifier failures and root/nullifier state.
- Document trusted setup, key rotation, disclosure, and incident response procedures.

## Security Caveats

- The current stub does not provide private token transfers or real confidentiality.
- Commitments alone are not sufficient; they need audited circuits, sound proof verification, nullifier checks, and careful public-input design.
- No value movement should depend on `verify_private_stream_proof_stub`, because it intentionally returns `false` and performs no proof validation.
- A production Groth16 system requires trusted setup management or a well-audited setup process, circuit audits, verifier audits, and test vectors.
- Metadata leakage remains: addresses, token identifiers, timing, transaction graph data, ledger events, and token movements may still reveal sensitive information.
- Protocol features such as BN254 and Poseidon/Poseidon2 host functions must be checked against actual network availability and this repository's `soroban-sdk = "22.0.0"` before use.
