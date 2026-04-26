/**
 * Knex configuration file
 * Development: SQLite3
 * Staging/Production: PostgreSQL
 */

module.exports = {

  development: {
    client: 'sqlite3',
    connection: {
      filename: './dev.sqlite3'
    },
    useNullAsDefault: true,        // required for SQLite
    migrations: {
      directory: './migrations'    // all migration files live here
    }
  },

  staging: {
    client: 'postgresql',
    connection: {
      database: 'your_staging_db',
      user:     'your_staging_user',
      password: 'your_staging_password'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations'
    }
  },

  production: {
    client: 'postgresql',
    connection: {
      database: 'your_production_db',
      user:     'your_prod_user',
      password: 'your_prod_password'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations'
    }
  }

};