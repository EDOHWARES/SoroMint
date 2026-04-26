describe('Environment Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should throw Validation Error if required variables are missing', () => {
    const { validateEnv } = require('../config/env-config');
    // Deliberately remove required config
    delete process.env.MONGO_URI;
    delete process.env.JWT_SECRET;
    delete process.env.SOROBAN_RPC_URL;

    expect(() => {
      validateEnv();
    }).toThrow(/Validation Error/);
  });

  it('should initEnv and catch failure logging to console', () => {
    const { initEnv } = require('../config/env-config');
    delete process.env.JWT_SECRET;
    delete process.env.SOROBAN_RPC_URL;
    
    // Mute console.error for expected logs during test
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => {
      initEnv();
    }).toThrow(/Validation Error/);
    
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should return already validated env on getEnv() if previously initialized', () => {
    const { initEnv, getEnv } = require('../config/env-config');
    
    // Provide valid env vars so initEnv() succeeds
    process.env.MONGO_URI = 'mongodb://localhost:27017/test';
    process.env.JWT_SECRET = 'secret';
    process.env.SOROBAN_RPC_URL = 'http://localhost';
    process.env.PORT = '5000';
    process.env.NETWORK_PASSPHRASE = 'test';

    const initialized = initEnv();
    const env = getEnv(); // this hits the early return !validatedEnv
    
    expect(env).toBeDefined();
    expect(env.PORT).toBe(5000);
    // ensure references match indicating caching works
    expect(initialized.PORT).toBe(env.PORT); 
  });
});
