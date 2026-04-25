const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const path = require('path');

/**
 * @title SoroMint API Configuration
 * @description Swagger configuration for SoroMint backend API documentation
 * @version 1.0.0
 */

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SoroMint API',
      version: '1.0.0',
      description: `
# SoroMint Backend API

A comprehensive API for managing Soroban token minting operations on the Stellar network.

## Features
- **Token Management**: Create and manage Soroban tokens
- **Asset Wrapping**: Wrap Stellar assets into Soroban tokens
- **Custom Contracts**: Deploy custom Stellar Asset Contracts
- **Streaming Payments**: Create time-based payment streams on Soroban
- **Governance**: Decentralized voting and proposal system
- **Vault System**: Collateralized lending vault operations
- **Dividend Distribution**: On-chain dividend distribution mechanisms

## Authentication
Authentication uses SEP-10 challenge-response flow with JWT tokens.
- Public routes: No authentication required
- Protected routes: Require \`Authorization: Bearer <token>\` header

## Networks
Supports Futurenet and Testnet environments.

## Error Handling
All errors return standardized JSON responses with:
- \`error\`: Human-readable error message
- \`code\`: Application-specific error code
- \`status\`: HTTP status code (when available)
`,
      contact: {
        name: 'SoroMint Team',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Development server',
      },
      {
        url: 'https://api.soromint.com',
        description: 'Production server',
      },
    ],
    tags: [
      { name: 'System', description: 'System health and status endpoints' },
      { name: 'Auth', description: 'Authentication and user management' },
      { name: 'Tokens', description: 'Token creation and management' },
      { name: 'Streaming', description: 'Time-based streaming payment operations' },
      { name: 'Vault', description: 'Collateralized vault operations' },
      { name: 'Dividend', description: 'Dividend distribution operations' },
      { name: 'Voting', description: 'Governance and voting system' },
      { name: 'Security', description: 'Security scanning and validation' },
      { name: 'Analytics', description: 'Platform analytics and metrics' },
      { name: 'Bridge', description: 'Cross-chain bridge operations' },
      { name: 'Webhooks', description: 'Webhook event management' },
      { name: 'Notifications', description: 'Notification management' },
      { name: 'API Keys', description: 'API key management' },
      { name: 'Batch', description: 'Batch operation endpoints' },
      { name: 'Audit', description: 'Audit and compliance endpoints' },
    ],
    components: {
      schemas: {
        Error: {
          type: 'object',
          description: 'Standard error response format',
          required: ['error', 'code'],
          properties: {
            error: {
              type: 'string',
              description: 'Human-readable error message',
              example: 'Missing required fields: name, symbol, and ownerPublicKey are required',
            },
            code: {
              type: 'string',
              description: 'Application-specific error code',
              example: 'VALIDATION_ERROR',
              enum: [
                'VALIDATION_ERROR',
                'INVALID_ID',
                'DUPLICATE_KEY',
                'NOT_FOUND',
                'ROUTE_NOT_FOUND',
                'INTERNAL_ERROR',
                'INVALID_TOKEN',
                'TOKEN_EXPIRED',
                'SYNTAX_ERROR',
                'UNAUTHORIZED',
                'FORBIDDEN',
              ],
            },
            status: {
              type: 'integer',
              description: 'HTTP status code',
              example: 400,
            },
            stack: {
              type: 'string',
              description: 'Stack trace (only in development mode)',
              example: 'Error: Validation failed\n    at Token.save...',
            },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            totalCount: { type: 'integer', description: 'Total number of records' },
            page: { type: 'integer', description: 'Current page number' },
            totalPages: { type: 'integer', description: 'Total number of pages' },
            limit: { type: 'integer', description: 'Records per page' },
          },
        },
        PaginationQuery: {
          type: 'object',
          properties: {
            page: { type: 'integer', default: 1, minimum: 1 },
            limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
          },
        },
        Token: {
          type: 'object',
          required: ['name', 'symbol', 'ownerPublicKey'],
          description: 'Represents a Soroban token on the Stellar network',
          properties: {
            _id: {
              type: 'string',
              description: 'MongoDB ObjectId of the token record',
              example: '507f1f77bcf86cd799439011',
            },
            name: {
              type: 'string',
              description: 'Full name of the token',
              example: 'SoroMint Token',
              minLength: 1,
              maxLength: 100,
            },
            symbol: {
              type: 'string',
              description: 'Token symbol/ticker (3-10 characters)',
              example: 'SORO',
              minLength: 1,
              maxLength: 10,
            },
            decimals: {
              type: 'integer',
              description: 'Number of decimal places for the token (default: 7)',
              example: 7,
              default: 7,
              minimum: 0,
              maximum: 18,
            },
            contractId: {
              type: 'string',
              description: 'Stellar contract address (C... format)',
              example: 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE',
              pattern: '^C[A-Z0-9]{55}$',
            },
            ownerPublicKey: {
              type: 'string',
              description: 'Owner\'s Stellar public key (G... format)',
              example: 'GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T',
              pattern: '^G[A-Z0-9]{55}$',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Timestamp when the token was created',
              example: '2024-01-15T10:30:00.000Z',
            },
          },
        },
        Stream: {
          type: 'object',
          description: 'Represents a streaming payment on Soroban',
          properties: {
            streamId: { type: 'string', description: 'Unique stream identifier' },
            sender: { type: 'string', description: 'Sender\'s Stellar public key' },
            recipient: { type: 'string', description: 'Recipient\'s Stellar public key' },
            tokenAddress: { type: 'string', description: 'Token contract address' },
            totalAmount: { type: 'string', description: 'Total streaming amount' },
            startLedger: { type: 'integer', description: 'Start ledger number' },
            stopLedger: { type: 'integer', description: 'Stop ledger number' },
            withdrawn: { type: 'string', description: 'Amount withdrawn so far' },
            status: {
              type: 'string',
              enum: ['active', 'paused', 'cancelled', 'completed'],
            },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Proposal: {
          type: 'object',
          description: 'Governance proposal',
          properties: {
            _id: { type: 'string', description: 'Proposal ID' },
            title: { type: 'string', description: 'Proposal title' },
            description: { type: 'string', description: 'Proposal description (Markdown)' },
            choices: { type: 'array', items: { type: 'string' }, description: 'Voting options' },
            creator: { type: 'string', description: 'Creator\'s Stellar public key' },
            status: {
              type: 'string',
              enum: ['pending', 'active', 'closed', 'cancelled'],
            },
            startTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
            voteCount: { type: 'integer' },
            totalVotingPower: { type: 'integer' },
            tally: { type: 'array', items: { type: 'integer' } },
          },
        },
        Vault: {
          type: 'object',
          description: 'Collateralized vault',
          properties: {
            vaultId: { type: 'string', description: 'Unique vault identifier' },
            owner: { type: 'string', description: 'Vault owner\'s Stellar public key' },
            collateralToken: { type: 'string', description: 'Collateral token contract address' },
            collateralAmount: { type: 'string', description: 'Collateral amount' },
            debt: { type: 'string', description: 'Outstanding debt' },
            healthFactor: { type: 'number', description: 'Health factor (1.0 = liquidation threshold)' },
            status: { type: 'string', enum: ['active', 'liquidated', 'closed'] },
          },
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'Access token is missing or invalid',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        ForbiddenError: {
          description: 'Access forbidden - insufficient permissions',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        ValidationError: {
          description: 'Request validation failed',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from /api/auth/login',
        },
      },
    },
    paths: {},
  },
  apis: [
    path.join(__dirname, '../routes/*.js'),
    path.join(__dirname, '../index.js'),
  ],
};

const swaggerSpec = swaggerJsdoc(options);

/**
 * Swagger UI setup
 * @notice Configures Swagger UI middleware for Express
 * @param {Object} app - Express application instance
 * @example
 * const swagger = require('./config/swagger');
 * swagger.setup(app);
 */
const setupSwagger = (app) => {
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      explorer: true,
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'SoroMint API Docs',
      customfavIcon: 'https://swagger.io/favicon-32x32.png',
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'list',
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
      },
    })
  );

  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  return swaggerSpec;
};

module.exports = {
  setupSwagger,
  swaggerSpec,
  options,
};
