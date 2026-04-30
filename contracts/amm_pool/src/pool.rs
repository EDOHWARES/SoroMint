use crate::events;
use core::cmp::min;
use soroban_sdk::{contract, contractimpl, contracttype, token::TokenClient, Address, Env, String};

const BPS_DENOMINATOR: i128 = 10_000;
const MAX_FEE_BPS: u32 = 1_000;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Factory,
    Token,
    QuoteToken,
    FeeBps,
    ReserveToken,
    ReserveQuote,
    TotalShares,
    ShareBalance(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolConfig {
    pub factory: Address,
    pub token: Address,
    pub quote_token: Address,
    pub fee_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolReserves {
    pub token_reserve: i128,
    pub quote_reserve: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidityPosition {
    pub token_amount: i128,
    pub quote_amount: i128,
    pub shares: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwapQuote {
    pub input_token: Address,
    pub output_token: Address,
    pub amount_in: i128,
    pub amount_out: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwapResult {
    pub input_token: Address,
    pub output_token: Address,
    pub amount_in: i128,
    pub amount_out: i128,
    pub new_input_reserve: i128,
    pub new_output_reserve: i128,
}

#[contract]
pub struct AmmPool;

#[contractimpl]
impl AmmPool {
    /// Initializes the AMM pool with factory and asset pair.
    /// 
    /// # Arguments
    /// * `factory` - The address of the AMM factory that created this pool.
    /// * `token` - The address of the first token in the pair.
    /// * `quote_token` - The address of the second token (quote asset) in the pair.
    /// * `fee_bps` - The trading fee in basis points.
    pub fn initialize(
        e: Env,
        factory: Address,
        token: Address,
        quote_token: Address,
        fee_bps: u32,
    ) {
        if e.storage().instance().has(&DataKey::Factory) {
            panic!("already initialized");
        }
        if token == quote_token {
            panic!("pool assets must differ");
        }
        if fee_bps > MAX_FEE_BPS {
            panic!("fee too high");
        }

        e.storage().instance().set(&DataKey::Factory, &factory);
        e.storage().instance().set(&DataKey::Token, &token);
        e.storage()
            .instance()
            .set(&DataKey::QuoteToken, &quote_token);
        e.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        e.storage().instance().set(&DataKey::ReserveToken, &0i128);
        e.storage().instance().set(&DataKey::ReserveQuote, &0i128);
        e.storage().instance().set(&DataKey::TotalShares, &0i128);

        events::emit_initialized(&e, &factory, &token, &quote_token, fee_bps);
    }

    /// Returns the configuration of the pool.
    pub fn config(e: Env) -> PoolConfig {
        PoolConfig {
            factory: Self::read_factory(&e),
            token: Self::read_token(&e),
            quote_token: Self::read_quote_token(&e),
            fee_bps: Self::read_fee_bps(&e),
        }
    }

    /// Returns the current reserves of both tokens in the pool.
    pub fn reserves(e: Env) -> PoolReserves {
        PoolReserves {
            token_reserve: Self::read_reserve_token(&e),
            quote_reserve: Self::read_reserve_quote(&e),
        }
    }

    /// Returns the share balance of a specific liquidity provider.
    pub fn share_balance(e: Env, provider: Address) -> i128 {
        Self::read_share_balance(&e, &provider)
    }

    /// Returns the total number of liquidity shares issued by the pool.
    pub fn total_shares(e: Env) -> i128 {
        Self::read_total_shares(&e)
    }

    /// Provides a quote for adding liquidity based on maximum input amounts.
    pub fn quote_add_liquidity(
        e: Env,
        max_token_amount: i128,
        max_quote_amount: i128,
    ) -> LiquidityPosition {
        if max_token_amount <= 0 || max_quote_amount <= 0 {
            panic!("liquidity amounts must be positive");
        }
        Self::compute_liquidity(&e, max_token_amount, max_quote_amount)
    }

    /// Adds liquidity to the pool.
    /// 
    /// # Arguments
    /// * `provider` - The address of the liquidity provider.
    /// * `max_token_amount` - The maximum amount of the first token to deposit.
    /// * `max_quote_amount` - The maximum amount of the quote token to deposit.
    /// * `min_shares` - The minimum number of shares to receive (slippage protection).
    pub fn add_liquidity(
        e: Env,
        provider: Address,
        max_token_amount: i128,
        max_quote_amount: i128,
        min_shares: i128,
    ) -> LiquidityPosition {
        provider.require_auth();
        let position = Self::compute_liquidity(&e, max_token_amount, max_quote_amount);
        if position.shares < min_shares {
            panic!("slippage exceeded");
        }

        let token = TokenClient::new(&e, &Self::read_token(&e));
        let quote = TokenClient::new(&e, &Self::read_quote_token(&e));
        let pool_address = e.current_contract_address();

        token.transfer(&provider, &pool_address, &position.token_amount);
        quote.transfer(&provider, &pool_address, &position.quote_amount);

        let new_token_reserve = Self::read_reserve_token(&e)
            .checked_add(position.token_amount)
            .unwrap();
        let new_quote_reserve = Self::read_reserve_quote(&e)
            .checked_add(position.quote_amount)
            .unwrap();
        let new_total_shares = Self::read_total_shares(&e)
            .checked_add(position.shares)
            .unwrap();
        let new_provider_shares = Self::read_share_balance(&e, &provider)
            .checked_add(position.shares)
            .unwrap();

        e.storage()
            .instance()
            .set(&DataKey::ReserveToken, &new_token_reserve);
        e.storage()
            .instance()
            .set(&DataKey::ReserveQuote, &new_quote_reserve);
        e.storage()
            .instance()
            .set(&DataKey::TotalShares, &new_total_shares);
        e.storage().persistent().set(
            &DataKey::ShareBalance(provider.clone()),
            &new_provider_shares,
        );

        events::emit_liquidity_added(
            &e,
            &provider,
            position.token_amount,
            position.quote_amount,
            position.shares,
        );

        position
    }

    /// Removes liquidity from the pool by burning shares.
    /// 
    /// # Arguments
    /// * `provider` - The address of the liquidity provider.
    /// * `shares` - The number of shares to burn.
    /// * `min_token_amount` - The minimum amount of the first token to receive.
    /// * `min_quote_amount` - The minimum amount of the quote token to receive.
    pub fn remove_liquidity(
        e: Env,
        provider: Address,
        shares: i128,
        min_token_amount: i128,
        min_quote_amount: i128,
    ) -> LiquidityPosition {
        provider.require_auth();
        if shares <= 0 {
            panic!("shares must be positive");
        }

        let total_shares = Self::read_total_shares(&e);
        if total_shares <= 0 {
            panic!("pool has no liquidity");
        }

        let provider_shares = Self::read_share_balance(&e, &provider);
        if provider_shares < shares {
            panic!("insufficient pool shares");
        }

        let token_reserve = Self::read_reserve_token(&e);
        let quote_reserve = Self::read_reserve_quote(&e);
        let token_amount = token_reserve.checked_mul(shares).unwrap() / total_shares;
        let quote_amount = quote_reserve.checked_mul(shares).unwrap() / total_shares;

        if token_amount <= 0 || quote_amount <= 0 {
            panic!("withdrawal too small");
        }
        if token_amount < min_token_amount || quote_amount < min_quote_amount {
            panic!("slippage exceeded");
        }

        let new_token_reserve = token_reserve.checked_sub(token_amount).unwrap();
        let new_quote_reserve = quote_reserve.checked_sub(quote_amount).unwrap();
        let new_total_shares = total_shares.checked_sub(shares).unwrap();
        let new_provider_shares = provider_shares.checked_sub(shares).unwrap();

        e.storage()
            .instance()
            .set(&DataKey::ReserveToken, &new_token_reserve);
        e.storage()
            .instance()
            .set(&DataKey::ReserveQuote, &new_quote_reserve);
        e.storage()
            .instance()
            .set(&DataKey::TotalShares, &new_total_shares);
        e.storage().persistent().set(
            &DataKey::ShareBalance(provider.clone()),
            &new_provider_shares,
        );

        let token = TokenClient::new(&e, &Self::read_token(&e));
        let quote = TokenClient::new(&e, &Self::read_quote_token(&e));
        let pool_address = e.current_contract_address();

        token.transfer(&pool_address, &provider, &token_amount);
        quote.transfer(&pool_address, &provider, &quote_amount);

        events::emit_liquidity_removed(&e, &provider, token_amount, quote_amount, shares);

        LiquidityPosition {
            token_amount,
            quote_amount,
            shares,
        }
    }

    /// Provides a quote for a token swap.
    pub fn quote_swap(e: Env, input_token: Address, amount_in: i128) -> SwapQuote {
        if amount_in <= 0 {
            panic!("swap amount must be positive");
        }
        let (output_token, amount_out) = Self::compute_swap(&e, &input_token, amount_in);
        SwapQuote {
            input_token,
            output_token,
            amount_in,
            amount_out,
        }
    }

    /// Performs a token swap.
    /// 
    /// # Arguments
    /// * `trader` - The address of the trader.
    /// * `input_token` - The address of the token being sold.
    /// * `amount_in` - The amount of input token to sell.
    /// * `min_amount_out` - The minimum amount of output token to receive.
    pub fn swap(
        e: Env,
        trader: Address,
        input_token: Address,
        amount_in: i128,
        min_amount_out: i128,
    ) -> SwapResult {
        trader.require_auth();
        if amount_in <= 0 {
            panic!("swap amount must be positive");
        }

        let (output_token, amount_out) = Self::compute_swap(&e, &input_token, amount_in);
        if amount_out < min_amount_out {
            panic!("slippage exceeded");
        }

        let token = TokenClient::new(&e, &input_token);
        let output = TokenClient::new(&e, &output_token);
        let pool_address = e.current_contract_address();

        token.transfer(&trader, &pool_address, &amount_in);
        output.transfer(&pool_address, &trader, &amount_out);

        let (new_input_reserve, new_output_reserve) =
            Self::apply_swap_reserve_update(&e, &input_token, amount_in, amount_out);

        events::emit_swap(
            &e,
            &trader,
            &input_token,
            &output_token,
            amount_in,
            amount_out,
        );

        SwapResult {
            input_token,
            output_token,
            amount_in,
            amount_out,
            new_input_reserve,
            new_output_reserve,
        }
    }

    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }
}

impl AmmPool {
    fn read_factory(e: &Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::Factory)
            .expect("not initialized")
    }

    fn read_token(e: &Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::Token)
            .expect("not initialized")
    }

    fn read_quote_token(e: &Env) -> Address {
        e.storage()
            .instance()
            .get(&DataKey::QuoteToken)
            .expect("not initialized")
    }

    fn read_fee_bps(e: &Env) -> u32 {
        e.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
    }

    fn read_reserve_token(e: &Env) -> i128 {
        e.storage()
            .instance()
            .get(&DataKey::ReserveToken)
            .unwrap_or(0)
    }

    fn read_reserve_quote(e: &Env) -> i128 {
        e.storage()
            .instance()
            .get(&DataKey::ReserveQuote)
            .unwrap_or(0)
    }

    fn read_total_shares(e: &Env) -> i128 {
        e.storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0)
    }

    fn read_share_balance(e: &Env, provider: &Address) -> i128 {
        e.storage()
            .persistent()
            .get(&DataKey::ShareBalance(provider.clone()))
            .unwrap_or(0)
    }

    fn compute_liquidity(
        e: &Env,
        max_token_amount: i128,
        max_quote_amount: i128,
    ) -> LiquidityPosition {
        if max_token_amount <= 0 || max_quote_amount <= 0 {
            panic!("liquidity amounts must be positive");
        }

        let token_reserve = Self::read_reserve_token(e);
        let quote_reserve = Self::read_reserve_quote(e);
        let total_shares = Self::read_total_shares(e);

        if total_shares == 0 {
            let shares =
                Self::integer_sqrt(max_token_amount.checked_mul(max_quote_amount).unwrap());
            if shares <= 0 {
                panic!("initial liquidity too small");
            }

            return LiquidityPosition {
                token_amount: max_token_amount,
                quote_amount: max_quote_amount,
                shares,
            };
        }

        if token_reserve <= 0 || quote_reserve <= 0 {
            panic!("pool reserves out of sync");
        }

        let left = max_token_amount.checked_mul(quote_reserve).unwrap();
        let right = max_quote_amount.checked_mul(token_reserve).unwrap();

        let (token_amount, quote_amount, shares) = if left <= right {
            let quote_amount = Self::ceil_div(left, token_reserve);
            let shares = max_token_amount.checked_mul(total_shares).unwrap() / token_reserve;
            (max_token_amount, quote_amount, shares)
        } else {
            let token_amount = Self::ceil_div(right, quote_reserve);
            let shares = max_quote_amount.checked_mul(total_shares).unwrap() / quote_reserve;
            (token_amount, max_quote_amount, shares)
        };

        if token_amount <= 0 || quote_amount <= 0 || shares <= 0 {
            panic!("liquidity addition too small");
        }
        if token_amount > max_token_amount || quote_amount > max_quote_amount {
            panic!("insufficient max amounts");
        }

        LiquidityPosition {
            token_amount,
            quote_amount,
            shares,
        }
    }

    fn compute_swap(e: &Env, input_token: &Address, amount_in: i128) -> (Address, i128) {
        let token = Self::read_token(e);
        let quote = Self::read_quote_token(e);
        let fee_bps = Self::read_fee_bps(e) as i128;

        let (reserve_in, reserve_out, output_token) = if *input_token == token {
            (
                Self::read_reserve_token(e),
                Self::read_reserve_quote(e),
                quote,
            )
        } else if *input_token == quote {
            (
                Self::read_reserve_quote(e),
                Self::read_reserve_token(e),
                token,
            )
        } else {
            panic!("unsupported swap asset");
        };

        if reserve_in <= 0 || reserve_out <= 0 {
            panic!("pool has no liquidity");
        }

        let amount_in_after_fee =
            amount_in.checked_mul(BPS_DENOMINATOR - fee_bps).unwrap() / BPS_DENOMINATOR;
        if amount_in_after_fee <= 0 {
            panic!("swap amount too small");
        }

        let numerator = reserve_out.checked_mul(amount_in_after_fee).unwrap();
        let denominator = reserve_in.checked_add(amount_in_after_fee).unwrap();
        let amount_out = numerator / denominator;

        if amount_out <= 0 || amount_out >= reserve_out {
            panic!("insufficient output amount");
        }

        (output_token, amount_out)
    }

    fn apply_swap_reserve_update(
        e: &Env,
        input_token: &Address,
        amount_in: i128,
        amount_out: i128,
    ) -> (i128, i128) {
        let token = Self::read_token(e);
        if *input_token == token {
            let new_token_reserve = Self::read_reserve_token(e).checked_add(amount_in).unwrap();
            let new_quote_reserve = Self::read_reserve_quote(e).checked_sub(amount_out).unwrap();
            e.storage()
                .instance()
                .set(&DataKey::ReserveToken, &new_token_reserve);
            e.storage()
                .instance()
                .set(&DataKey::ReserveQuote, &new_quote_reserve);
            (new_token_reserve, new_quote_reserve)
        } else {
            let new_quote_reserve = Self::read_reserve_quote(e).checked_add(amount_in).unwrap();
            let new_token_reserve = Self::read_reserve_token(e).checked_sub(amount_out).unwrap();
            e.storage()
                .instance()
                .set(&DataKey::ReserveQuote, &new_quote_reserve);
            e.storage()
                .instance()
                .set(&DataKey::ReserveToken, &new_token_reserve);
            (new_quote_reserve, new_token_reserve)
        }
    }

    fn ceil_div(value: i128, divisor: i128) -> i128 {
        if divisor <= 0 {
            panic!("invalid divisor");
        }
        value.checked_add(divisor - 1).unwrap() / divisor
    }

    fn integer_sqrt(value: i128) -> i128 {
        if value < 0 {
            panic!("sqrt of negative value");
        }
        if value < 2 {
            return value;
        }

        let mut x0 = value;
        let mut x1 = (x0 + value / x0) / 2;
        while x1 < x0 {
            x0 = x1;
            x1 = (x0 + value / x0) / 2;
        }
        min(x0, value / x0)
    }
}
