process.env.NODE_ENV = 'test';
process.env.MONGOMS_MD5_CHECK = '0';
process.env.PORT = '5000';
// Mock MongoDB URI (the tests themselves will start an in-memory db and reconnect)
process.env.MONGO_URI = 'mongodb://localhost:27017/test-db';
process.env.JWT_SECRET = 'super-secret-test-key';
process.env.JWT_EXPIRES_IN = '24h';
process.env.SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
process.env.NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
// SEP-10 challenge-response auth.
// Leave empty so sep10-challenge-service auto-generates a stable ephemeral
// keypair for the lifetime of the test process (safe for tests only).
process.env.SERVER_SIGNING_SECRET = '';
