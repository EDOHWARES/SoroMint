/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();          // Primary key
    table.string('display_name').notNullable(); // User display name
    table.string('avatar_url');                 // Avatar image URL
    table.decimal('wallet_balance', 18, 8).defaultTo(0); // Wallet balance
    table.timestamps(true, true);              // created_at & updated_at
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('users');
}