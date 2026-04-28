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

## Authentication
Currently, this API does not require authentication. In production, API keys or JWT tokens should be implemented.

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
        description: 'Production server (future)',
      },
    ],
    tags: [
      {
        name: 'Tokens',
        description: 'Token management operations',
      },
      {
        name: 'System',
        description: 'System health and status endpoints',
      },
    ],
    components: {
      schemas: {
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
              description:
                'Number of decimal places for the token (default: 7)',
              example: 7,
              default: 7,
              minimum: 0,
              maximum: 18,
            },
            contractId: {
              type: 'string',
              description: 'Stellar contract address (C... format)',
              example:
                'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE',
              pattern: '^C[A-Z0-9]{55}$',
            },
            ownerPublicKey: {
              type: 'string',
              description: "Owner's Stellar public key (G... format)",
              example:
                'GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T',
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
        TokenCreateInput: {
          type: 'object',
          required: ['name', 'symbol', 'ownerPublicKey'],
          description: 'Input schema for creating a new token',
          properties: {
            name: {
              type: 'string',
              description: 'Full name of the token',
              example: 'SoroMint Token',
              minLength: 1,
              maxLength: 100,
            },
            symbol: {
              type: 'string',
              description: 'Token symbol/ticker',
              example: 'SORO',
              minLength: 1,
              maxLength: 10,
            },
            decimals: {
              type: 'integer',
              description: 'Number of decimal places (default: 7)',
              example: 7,
              default: 7,
              minimum: 0,
              maximum: 18,
            },
            contractId: {
              type: 'string',
              description:
                'Stellar contract address (optional, auto-generated if not provided)',
              example:
                'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE',
            },
            ownerPublicKey: {
              type: 'string',
              description: "Owner's Stellar public key",
              example:
                'GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T',
            },
          },
        },
        Error: {
          type: 'object',
          description: 'Standard error response format',
          required: ['error', 'code'],
          properties: {
            error: {
              type: 'string',
              description: 'Human-readable error message',
              example:
                'Missing required fields: name, symbol, and ownerPublicKey are required',
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
        Status: {
          type: 'object',
          description: 'Server status response',
          properties: {
            status: {
              type: 'string',
              description: 'Current server status',
              example: 'Server is running',
            },
            network: {
              type: 'string',
              description: 'Stellar network passphrase',
              example: 'Test SDF Network ; September 2015',
            },
          },
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'Access token is missing or invalid',
        },
      },
    },
    // Define paths directly for better control
    paths: {
      '/api/status': {
        get: {
          tags: ['System'],
          summary: 'Get server status',
          description:
            'Retrieves the current server status and network configuration',
          operationId: 'getStatus',
          responses: {
            200: {
              description: 'Server status information',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Status',
                  },
                },
              },
            },
            default: {
              description: 'Unexpected error',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error',
                  },
                },
              },
            },
          },
        },
      },
      '/api/tokens/{owner}': {
        get: {
          tags: ['Tokens'],
          summary: 'Get tokens by owner',
          description:
            'Retrieves all tokens owned by a specific Stellar public key',
          operationId: 'getTokensByOwner',
          parameters: [
            {
              name: 'owner',
              in: 'path',
              required: true,
              description: "Owner's Stellar public key",
              schema: {
                type: 'string',
                example:
                  'GBZ4XGQW5X6V7Y2Z3A4B5C6D7E8F9G0H1I2J3K4L5M6N7O8P9Q0R1S2T',
              },
            },
          ],
          responses: {
            200: {
              description: 'Array of tokens owned by the specified address',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      $ref: '#/components/schemas/Token',
                    },
                  },
                },
              },
            },
            400: {
              description: 'Invalid owner public key format',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error',
                  },
                },
              },
            },
            default: {
              description: 'Unexpected error',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error',
                  },
                },
              },
            },
          },
        },
      },
      '/api/tokens': {
        post: {
          tags: ['Tokens'],
          summary: 'Create a new token',
          description: 'Creates a new Soroban token record',
          operationId: 'createToken',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/TokenCreateInput',
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Successfully created token',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Token',
                  },
                },
              },
            },
            400: {
              description: 'Missing required fields or validation error',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error',
                  },
                },
              },
            },
            409: {
              description: 'Token with this contractId already exists',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error',
                  },
                },
              },
            },
            default: {
              description: 'Unexpected error',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  apis: [
    path.join(__dirname, '../index.js'),
    path.join(__dirname, '../models/*.js'),
    path.join(__dirname, '../services/*.js'),
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
    })
  );

  // Serve raw JSON spec
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
