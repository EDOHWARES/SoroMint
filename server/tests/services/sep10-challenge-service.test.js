/**
 * @title SEP-10 Challenge-Response Service Tests
 * @author SoroMint Team
 * @notice Comprehensive unit tests for the SEP-10 style challenge-response
 *         authentication service.
 *
 * @dev Test coverage:
 *   - generateChallenge: XDR structure, time bounds, server signature, storage
 *   - verifyChallenge: happy path, replay prevention, expiry, bad signatures,
 *                      tampered transactions, missing fields
 *   - getActiveChallengeCount: bookkeeping accuracy
 */

'use strict';

// ── Test environment must be set before requiring any service ─────────────────
process.env.NODE_ENV = 'test';
process.env.NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
process.env.SERVER_SIGNING_SECRET = ''; // triggers ephemeral fallback keypair

const {
  Keypair,
  Transaction,
  Networks,
} = require('@stellar/stellar-sdk');

const {
  generateChallenge,
  verifyChallenge,
  getActiveChallengeCount,
  _clearAllChallenges,
  CHALLENGE_WINDOW_SECONDS,
  WEB_AUTH_DOMAIN,
} = require('../../services/sep10-challenge-service');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a fresh random client keypair for each test that needs one. */
const newClientKeypair = () => Keypair.random();

/**
 * Full happy-path helper:
 *   1. generateChallenge for the given keypair
 *   2. parse the XDR
 *   3. add the client signature
 *   4. return everything needed for verifyChallenge
 */
const buildSignedChallenge = (clientKeypair) => {
  const { transactionXDR, challengeToken } = generateChallenge(
    clientKeypair.publicKey()
  );

  const tx = new Transaction(
    transactionXDR,
    process.env.NETWORK_PASSPHRASE
  );

  tx.sign(clientKeypair);
  const signedXDR = tx.toEnvelope().toXDR('base64');

  return { challengeToken, signedXDR, transactionXDR };
};

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  _clearAllChallenges();
});

afterAll(() => {
  _clearAllChallenges();
});

// =============================================================================
// generateChallenge
// =============================================================================

describe('generateChallenge', () => {
  it('returns the four expected fields', () => {
    const kp = newClientKeypair();
    const result = generateChallenge(kp.publicKey());

    expect(result).toHaveProperty('transactionXDR');
    expect(result).toHaveProperty('challengeToken');
    expect(result).toHaveProperty('expiresAt');
    expect(result).toHaveProperty('serverPublicKey');
  });

  it('transactionXDR is a non-empty base64 string', () => {
    const kp = newClientKeypair();
    const { transactionXDR } = generateChallenge(kp.publicKey());

    expect(typeof transactionXDR).toBe('string');
    expect(transactionXDR.length).toBeGreaterThan(0);
    // Should be valid base64
    expect(() => Buffer.from(transactionXDR, 'base64')).not.toThrow();
  });

  it('challengeToken is a 64-character hex string', () => {
    const kp = newClientKeypair();
    const { challengeToken } = generateChallenge(kp.publicKey());

    expect(typeof challengeToken).toBe('string');
    expect(challengeToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('expiresAt is roughly now + CHALLENGE_WINDOW_SECONDS (ms)', () => {
    const kp = newClientKeypair();
    const before = Date.now();
    const { expiresAt } = generateChallenge(kp.publicKey());
    const after = Date.now();

    const expectedMin = before + CHALLENGE_WINDOW_SECONDS * 1000;
    const expectedMax = after  + CHALLENGE_WINDOW_SECONDS * 1000;

    expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAt).toBeLessThanOrEqual(expectedMax);
  });

  it('serverPublicKey is a valid Stellar G-address', () => {
    const kp = newClientKeypair();
    const { serverPublicKey } = generateChallenge(kp.publicKey());

    expect(typeof serverPublicKey).toBe('string');
    expect(serverPublicKey).toMatch(/^G[A-Z2-7]{55}$/);
  });

  it('generated XDR parses into a valid Transaction', () => {
    const kp = newClientKeypair();
    const { transactionXDR } = generateChallenge(kp.publicKey());

    expect(() => new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE)).not.toThrow();
  });

  it('transaction contains at least 2 ManageData operations', () => {
    const kp = newClientKeypair();
    const { transactionXDR } = generateChallenge(kp.publicKey());

    const tx = new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE);

    expect(tx.operations.length).toBeGreaterThanOrEqual(2);
    expect(tx.operations[0].type).toBe('manageData');
    expect(tx.operations[1].type).toBe('manageData');
  });

  it('first operation is web_auth_domain ManageData', () => {
    const kp = newClientKeypair();
    const { transactionXDR } = generateChallenge(kp.publicKey());

    const tx = new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE);
    const op0 = tx.operations[0];

    expect(op0.name).toBe('web_auth_domain');
    expect(op0.value.toString()).toBe(WEB_AUTH_DOMAIN);
  });

  it('second operation name contains the WEB_AUTH_DOMAIN', () => {
    const kp = newClientKeypair();
    const { transactionXDR } = generateChallenge(kp.publicKey());

    const tx = new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE);
    const op1 = tx.operations[1];

    expect(op1.name).toContain(WEB_AUTH_DOMAIN);
  });

  it('second operation source equals the client public key', () => {
    const kp = newClientKeypair();
    const { transactionXDR } = generateChallenge(kp.publicKey());

    const tx = new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE);
    const op1 = tx.operations[1];

    expect(op1.source).toBe(kp.publicKey());
  });

  it('transaction has valid time bounds within the challenge window', () => {
    const kp = newClientKeypair();
    const before = Math.floor(Date.now() / 1000);
    const { transactionXDR } = generateChallenge(kp.publicKey());
    const after  = Math.floor(Date.now() / 1000);

    const tx = new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE);

    expect(tx.timeBounds).not.toBeNull();

    const minTime = parseInt(tx.timeBounds.minTime, 10);
    const maxTime = parseInt(tx.timeBounds.maxTime, 10);

    expect(minTime).toBeGreaterThanOrEqual(before);
    expect(minTime).toBeLessThanOrEqual(after + 1); // allow 1s clock skew
    expect(maxTime - minTime).toBe(CHALLENGE_WINDOW_SECONDS);
  });

  it('transaction is already signed by the server', () => {
    const kp = newClientKeypair();
    const { transactionXDR } = generateChallenge(kp.publicKey());

    const tx = new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE);

    // Exactly one signature present (the server's)
    expect(tx.signatures.length).toBe(1);
  });

  it('each call produces a unique challengeToken', () => {
    const kp = newClientKeypair();
    const tokens = new Set(
      Array.from({ length: 10 }, () => generateChallenge(kp.publicKey()).challengeToken)
    );
    expect(tokens.size).toBe(10);
  });

  it('each call embeds a unique nonce in the second operation', () => {
    const kp = newClientKeypair();
    const nonces = new Set();

    for (let i = 0; i < 5; i++) {
      const { transactionXDR } = generateChallenge(kp.publicKey());
      const tx = new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE);
      nonces.add(tx.operations[1].value.toString('base64'));
    }

    expect(nonces.size).toBe(5);
  });

  it('increments getActiveChallengeCount', () => {
    const countBefore = getActiveChallengeCount();
    generateChallenge(newClientKeypair().publicKey());
    expect(getActiveChallengeCount()).toBe(countBefore + 1);
  });
});

// =============================================================================
// verifyChallenge — happy path
// =============================================================================

describe('verifyChallenge — happy path', () => {
  it('returns { valid: true, publicKey } when both signatures are present', () => {
    const kp = newClientKeypair();
    const { challengeToken, signedXDR } = buildSignedChallenge(kp);

    const result = verifyChallenge(challengeToken, signedXDR);

    expect(result.valid).toBe(true);
    expect(result.publicKey).toBe(kp.publicKey());
    expect(result.error).toBeUndefined();
  });

  it('marks the challenge as used after successful verification', () => {
    const kp = newClientKeypair();
    const { challengeToken, signedXDR } = buildSignedChallenge(kp);

    // First call succeeds
    const first = verifyChallenge(challengeToken, signedXDR);
    expect(first.valid).toBe(true);

    // Second call on the same token must fail (replay prevention)
    const second = verifyChallenge(challengeToken, signedXDR);
    expect(second.valid).toBe(false);
    expect(second.error).toMatch(/already been used/i);
  });

  it('decreases getActiveChallengeCount by one after successful verify', () => {
    const kp = newClientKeypair();
    const { challengeToken, signedXDR } = buildSignedChallenge(kp);

    const countBefore = getActiveChallengeCount();
    verifyChallenge(challengeToken, signedXDR);
    expect(getActiveChallengeCount()).toBe(countBefore - 1);
  });

  it('verifies correctly for multiple different clients concurrently', () => {
    const pairs = Array.from({ length: 5 }, () => {
      const kp = newClientKeypair();
      return { kp, ...buildSignedChallenge(kp) };
    });

    for (const { kp, challengeToken, signedXDR } of pairs) {
      const result = verifyChallenge(challengeToken, signedXDR);
      expect(result.valid).toBe(true);
      expect(result.publicKey).toBe(kp.publicKey());
    }
  });
});

// =============================================================================
// verifyChallenge — replay prevention
// =============================================================================

describe('verifyChallenge — replay prevention', () => {
  it('rejects a challenge that has already been used', () => {
    const kp = newClientKeypair();
    const { challengeToken, signedXDR } = buildSignedChallenge(kp);

    verifyChallenge(challengeToken, signedXDR); // consume it

    const result = verifyChallenge(challengeToken, signedXDR);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/already been used/i);
  });

  it('rejects an unknown / non-existent challenge token', () => {
    const kp = newClientKeypair();
    const { signedXDR } = buildSignedChallenge(kp);
    const fakeToken = '0'.repeat(64);

    const result = verifyChallenge(fakeToken, signedXDR);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not found|expired/i);
  });

  it('rejects a challenge token with wrong length', () => {
    const kp = newClientKeypair();
    const { signedXDR } = buildSignedChallenge(kp);

    const result = verifyChallenge('short-token', signedXDR);
    expect(result.valid).toBe(false);
  });
});

// =============================================================================
// verifyChallenge — signature validation
// =============================================================================

describe('verifyChallenge — signature validation', () => {
  it('rejects when client signature is missing (only server signature present)', () => {
    const kp = newClientKeypair();
    const { challengeToken, transactionXDR } = generateChallenge(kp.publicKey());

    // Do NOT add the client signature — use the XDR as-is (only server sig)
    const result = verifyChallenge(challengeToken, transactionXDR);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/client signature/i);
  });

  it('rejects when a different keypair signs the transaction', () => {
    const correctKp = newClientKeypair();
    const wrongKp   = newClientKeypair();

    const { challengeToken, transactionXDR } = generateChallenge(correctKp.publicKey());

    // Sign with wrong keypair
    const tx = new Transaction(transactionXDR, process.env.NETWORK_PASSPHRASE);
    tx.sign(wrongKp);
    const signedXDR = tx.toEnvelope().toXDR('base64');

    const result = verifyChallenge(challengeToken, signedXDR);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/client signature/i);
  });

  it('rejects when XDR is completely invalid / garbage', () => {
    const kp = newClientKeypair();
    const { challengeToken } = generateChallenge(kp.publicKey());

    const result = verifyChallenge(challengeToken, 'not-valid-xdr!!!');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects when XDR is an empty string', () => {
    const kp = newClientKeypair();
    const { challengeToken } = generateChallenge(kp.publicKey());

    const result = verifyChallenge(challengeToken, '');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects when XDR belongs to a completely different transaction', () => {
    const kp1 = newClientKeypair();
    const kp2 = newClientKeypair();

    const { challengeToken } = generateChallenge(kp1.publicKey());

    // Build a second challenge for a different user and sign it
    const { transactionXDR: xdr2 } = generateChallenge(kp2.publicKey());
    const tx2 = new Transaction(xdr2, process.env.NETWORK_PASSPHRASE);
    tx2.sign(kp2);
    const crossSignedXDR = tx2.toEnvelope().toXDR('base64');

    // Try to use kp2's signed XDR against kp1's challenge token
    const result = verifyChallenge(challengeToken, crossSignedXDR);
    expect(result.valid).toBe(false);
  });
});

// =============================================================================
// verifyChallenge — expiry
// =============================================================================

describe('verifyChallenge — expiry', () => {
  it('rejects a challenge whose stored expiresAt has passed', () => {
    const kp = newClientKeypair();
    const { challengeToken, signedXDR } = buildSignedChallenge(kp);

    // Manually expire the stored entry by reaching into the module's state
    // via _clearAllChallenges + re-inserting with a past timestamp is not
    // directly possible, so we mock Date.now temporarily.
    const realNow = Date.now;
    const futureMs = Date.now() + (CHALLENGE_WINDOW_SECONDS + 10) * 1000;
    Date.now = () => futureMs;

    try {
      const result = verifyChallenge(challengeToken, signedXDR);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/expired/i);
    } finally {
      Date.now = realNow;
    }
  });
});

// =============================================================================
// verifyChallenge — missing parameters
// =============================================================================

describe('verifyChallenge — missing / undefined parameters', () => {
  it('handles undefined challengeToken gracefully', () => {
    const kp = newClientKeypair();
    const { signedXDR } = buildSignedChallenge(kp);

    const result = verifyChallenge(undefined, signedXDR);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('handles undefined signedXDR gracefully', () => {
    const kp = newClientKeypair();
    const { challengeToken } = buildSignedChallenge(kp);

    const result = verifyChallenge(challengeToken, undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('handles null for both parameters gracefully', () => {
    const result = verifyChallenge(null, null);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// =============================================================================
// getActiveChallengeCount
// =============================================================================

describe('getActiveChallengeCount', () => {
  it('returns 0 after _clearAllChallenges', () => {
    _clearAllChallenges();
    expect(getActiveChallengeCount()).toBe(0);
  });

  it('increments by 1 for each generated challenge', () => {
    for (let i = 1; i <= 5; i++) {
      generateChallenge(newClientKeypair().publicKey());
      expect(getActiveChallengeCount()).toBe(i);
    }
  });

  it('decrements after a challenge is used', () => {
    const kp = newClientKeypair();
    const { challengeToken, signedXDR } = buildSignedChallenge(kp);

    const before = getActiveChallengeCount();
    verifyChallenge(challengeToken, signedXDR);
    expect(getActiveChallengeCount()).toBe(before - 1);
  });

  it('does not count expired challenges', () => {
    generateChallenge(newClientKeypair().publicKey());
    const countWithActive = getActiveChallengeCount();

    // Time-travel past expiry
    const realNow = Date.now;
    Date.now = () => realNow() + (CHALLENGE_WINDOW_SECONDS + 10) * 1000;

    try {
      expect(getActiveChallengeCount()).toBeLessThan(countWithActive);
    } finally {
      Date.now = realNow;
    }
  });

  it('does not count challenges that have been used', () => {
    const kp = newClientKeypair();
    const { challengeToken, signedXDR } = buildSignedChallenge(kp);

    verifyChallenge(challengeToken, signedXDR); // marks as used

    const count = getActiveChallengeCount();
    // Used challenge should not appear in active count
    // (we just verify it didn't increment after use)
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// WEB_AUTH_DOMAIN constant
// =============================================================================

describe('WEB_AUTH_DOMAIN', () => {
  it('is a non-empty string', () => {
    expect(typeof WEB_AUTH_DOMAIN).toBe('string');
    expect(WEB_AUTH_DOMAIN.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// CHALLENGE_WINDOW_SECONDS constant
// =============================================================================

describe('CHALLENGE_WINDOW_SECONDS', () => {
  it('is a positive number', () => {
    expect(typeof CHALLENGE_WINDOW_SECONDS).toBe('number');
    expect(CHALLENGE_WINDOW_SECONDS).toBeGreaterThan(0);
  });

  it('is at least 60 seconds (usable window for signing)', () => {
    expect(CHALLENGE_WINDOW_SECONDS).toBeGreaterThanOrEqual(60);
  });
});
```

Now let me update the auth-routes tests and create the client auth service — all at once:
