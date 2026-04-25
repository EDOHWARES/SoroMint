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

    pub fn config(e: Env) -> PoolConfig {
        PoolConfig {
            factory: Self::read_factory(&e),
            token: Self::read_token(&e),
            quote_token: Self::read_quote_token(&e),
            fee_bps: Self::read_fee_bps(&e),
        }
    }

    pub fn reserves(e: Env) -> PoolReserves {
        PoolReserves {
            token_reserve: Self::read_reserve_token(&e),
            quote_reserve: Self::read_reserve_quote(&e),
        }
    }

    pub fn share_balance(e: Env, provider: Address) -> i128 {
        Self::read_share_balance(&e, &provider)
    }

    pub fn total_shares(e: Env) -> i128 {
        Self::read_total_shares(&e)
    }

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
            .expect("token reserve addition overflow");
        let new_quote_reserve = Self::read_reserve_quote(&e)
            .checked_add(position.quote_amount)
            .expect("quote reserve addition overflow");
        let new_total_shares = Self::read_total_shares(&e)
            .checked_add(position.shares)
            .expect("total shares addition overflow");
        let new_provider_shares = Self::read_share_balance(&e, &provider)
            .checked_add(position.shares)
            .expect("provider shares addition overflow");

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
        let token_amount = token_reserve
            .checked_mul(shares)
            .expect("token withdrawal multiplication overflow")
            .checked_div(total_shares)
            .expect("token withdrawal division failed");
        let quote_amount = quote_reserve
            .checked_mul(shares)
            .expect("quote withdrawal multiplication overflow")
            .checked_div(total_shares)
            .expect("quote withdrawal division failed");

        if token_amount <= 0 || quote_amount <= 0 {
            panic!("withdrawal too small");
        }
        if token_amount < min_token_amount || quote_amount < min_quote_amount {
            panic!("slippage exceeded");
        }

        let new_token_reserve = token_reserve
            .checked_sub(token_amount)
            .expect("token reserve subtraction underflow");
        let new_quote_reserve = quote_reserve
            .checked_sub(quote_amount)
            .expect("quote reserve subtraction underflow");
        let new_total_shares = total_shares
            .checked_sub(shares)
            .expect("total shares subtraction underflow");
        let new_provider_shares = provider_shares
            .checked_sub(shares)
            .expect("provider shares subtraction underflow");

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
                Self::integer_sqrt(
                    max_token_amount
                        .checked_mul(max_quote_amount)
                        .expect("initial liquidity multiplication overflow"),
                );
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

        let left = max_token_amount
            .checked_mul(quote_reserve)
            .expect("liquidity ratio multiplication overflow");
        let right = max_quote_amount
            .checked_mul(token_reserve)
            .expect("liquidity ratio multiplication overflow");

        let (token_amount, quote_amount, shares) = if left <= right {
            let quote_amount = Self::ceil_div(left, token_reserve);
            let shares = max_token_amount
                .checked_mul(total_shares)
                .expect("share calculation multiplication overflow")
                .checked_div(token_reserve)
                .expect("share calculation division failed");
            (max_token_amount, quote_amount, shares)
        } else {
            let token_amount = Self::ceil_div(right, quote_reserve);
            let shares = max_quote_amount
                .checked_mul(total_shares)
                .expect("share calculation multiplication overflow")
                .checked_div(quote_reserve)
                .expect("share calculation division failed");
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
            amount_in
                .checked_mul(BPS_DENOMINATOR - fee_bps)
                .expect("swap fee multiplication overflow")
                .checked_div(BPS_DENOMINATOR)
                .expect("swap fee division failed");
        if amount_in_after_fee <= 0 {
            panic!("swap amount too small");
        }

        let numerator = reserve_out
            .checked_mul(amount_in_after_fee)
            .expect("swap numerator multiplication overflow");
        let denominator = reserve_in
            .checked_add(amount_in_after_fee)
            .expect("swap denominator addition overflow");
        let amount_out = numerator
            .checked_div(denominator)
            .expect("swap output division failed");

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
            let new_token_reserve = Self::read_reserve_token(e)
                .checked_add(amount_in)
                .expect("token reserve swap addition overflow");
            let new_quote_reserve = Self::read_reserve_quote(e)
                .checked_sub(amount_out)
                .expect("quote reserve swap subtraction underflow");
            e.storage()
                .instance()
                .set(&DataKey::ReserveToken, &new_token_reserve);
            e.storage()
                .instance()
                .set(&DataKey::ReserveQuote, &new_quote_reserve);
            (new_token_reserve, new_quote_reserve)
        } else {
            let new_quote_reserve = Self::read_reserve_quote(e)
                .checked_add(amount_in)
                .expect("quote reserve swap addition overflow");
            let new_token_reserve = Self::read_reserve_token(e)
                .checked_sub(amount_out)
                .expect("token reserve swap subtraction underflow");
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
        value
            .checked_add(
                divisor
                    .checked_sub(1)
                    .expect("ceil_div divisor decrement underflow"),
            )
            .expect("ceil_div addition overflow")
            .checked_div(divisor)
            .expect("ceil_div division failed")
    }

    fn integer_sqrt(value: i128) -> i128 {
        if value < 0 {
            panic!("sqrt of negative value");
        }
        if value < 2 {
            return value;
        }

        let mut x0 = value;
        let mut x1 = x0
            .checked_add(value.checked_div(x0).expect("sqrt division failed"))
            .expect("sqrt addition overflow")
            .checked_div(2)
            .expect("sqrt division failed");
        while x1 < x0 {
            x0 = x1;
            x1 = x0
                .checked_add(value.checked_div(x0).expect("sqrt division failed"))
                .expect("sqrt addition overflow")
                .checked_div(2)
                .expect("sqrt division failed");
        }
        min(
            x0,
            value
                .checked_div(x0)
                .expect("sqrt final division failed"),
        )
    }
}
