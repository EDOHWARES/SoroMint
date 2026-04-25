/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.createTable('platform_fee_configs', (table) => {
    table.string('_id').primary();                   // MongoDB ObjectId
    table.string('tokenAddress').notNullable().index(); // Token contract address
    table.decimal('feePercentage', 5, 4).notNullable(); // Fee percentage (e.g., 0.0100 for 1%)
    table.boolean('isActive').defaultTo(true);       // Whether this config is active
    table.string('minFeeAmount').defaultTo('0');     // Minimum fee amount
    table.string('maxFeeAmount');                     // Maximum fee amount (optional)
    table.string('description');                     // Configuration description
    table.string('updatedBy').notNullable();         // Admin who updated this config
    table.timestamps(true, true);                    // created_at & updated_at
  });

  // Create index for token and active status queries
  await knex.raw('CREATE INDEX idx_platform_fee_configs_token_active ON platform_fee_configs (tokenAddress, isActive)');
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('platform_fee_configs');
}
