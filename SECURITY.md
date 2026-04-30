# Security Policy & Fast-Track Process

SoroMint follows a **Security-First** mindset. This document outlines the process for handling security vulnerabilities and fast-tracking fixes identified during professional audits or by the community.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately to the maintainers. Do not open a public GitHub issue for security-related bugs.

**Email**: security@soromint.io (Dummy)

## Audit Fast-Track Process

When a professional audit identifies a high-severity or critical vulnerability, the following "Fast-Track" process is triggered to ensure mainnet safety:

### 1. Triage & Impact Analysis
- **Timeline**: Within 4 hours of receipt.
- **Action**: Security lead confirms the finding and determines if a mainnet pause is required.
- **Communication**: Immediate internal alert to the core engineering team.

### 2. Isolation & Patching
- **Timeline**: Within 12-24 hours.
- **Action**: Fixes are developed in a private repository/branch to prevent public exploitation before deployment.
- **Review**: Mandatory peer review by at least two senior engineers and, if possible, the original auditor.

### 3. Emergency Testing
- **Timeline**: Within 2-4 hours after patching.
- **Action**: Accelerated unit and integration tests specifically targeting the vulnerability and its side effects.
- **Validation**: Verify the fix in a dedicated staging environment (Testnet).

### 4. Mainnet Deployment
- **Timeline**: Immediate upon successful testing.
- **Action**: Use the `upgradeable` contract pattern to swap the logic with the patched version.
- **Multisig**: Trigger an emergency multisig transaction for immediate approval.

### 5. Post-Mortem & Disclosure
- **Timeline**: Within 7 days of deployment.
- **Action**: Publish a detailed post-mortem and credit the auditor/reporter.
- **Update**: Update documentation and automated tests to prevent regression.

## Security Controls
- **Pause Mechanism**: All core contracts implement a `require_not_paused` guard.
- **Multisig Governance**: Critical upgrades require a 3-of-5 signature from the MultiSigAdmin contract.
- **Formal Verification**: Critical logic (e.g., Vault collateral ratios) is subject to formal verification where applicable.

---
*This process is defined and ready for mainnet deployment as of April 2026.*
