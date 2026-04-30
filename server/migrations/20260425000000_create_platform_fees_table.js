/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.createTable('platform_fees', (table) => {
    table.string('_id').primary();                   // MongoDB ObjectId
    table.string('streamId').notNullable().index();  // Reference to stream
    table.string('feeAmount').notNullable();         // Fee amount
    table.decimal('feePercentage', 5, 4).notNullable(); // Fee percentage (e.g., 0.0100 for 1%)
    table.string('streamTotalAmount').notNullable(); // Total stream amount
    table.string('tokenAddress').notNullable().index(); // Token contract address
    table.enum('status', ['collected', 'withdrawn', 'pending']).defaultTo('collected').index(); // Fee status
    table.string('withdrawnAmount').defaultTo('0');  // Amount withdrawn
    table.string('withdrawnTxHash');                 // Withdrawal transaction hash
    table.timestamp('withdrawnAt');                  // Withdrawal timestamp
    table.string('withdrawnBy');                     // Admin who withdrew
    table.string('collectionTxHash').notNullable();  // Stream creation transaction hash
    table.timestamps(true, true);                    // created_at & updated_at
  });

  // Create indexes for better query performance
  await knex.raw('CREATE INDEX idx_platform_fees_status_created ON platform_fees (status, created_at DESC)');
  await knex.raw('CREATE INDEX idx_platform_fees_token_status ON platform_fees (tokenAddress, status)');
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('platform_fees');
}
