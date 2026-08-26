#![no_std]

mod events;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol, Vec};

/// Price scale matching the AMM pool and push oracle (7 decimals).
#[allow(dead_code)]
pub const PRICE_SCALE: i128 = 10_000_000;
const MIN_WINDOW: u64 = 60;
const MAX_WINDOW: u64 = 86_400;
const DEFAULT_WINDOW: u64 = 1_800;
const MIN_CARDINALITY: u32 = 8;
const MAX_CARDINALITY: u32 = 128;
const MIN_INTERVAL: u32 = 1;
const MAX_INTERVAL: u32 = 3_600;

#[contracttype]
pub enum ConfigKey {
    Admin,
    DefaultWindow,
}

#[contracttype]
pub enum DataKey {
    Config(ConfigKey),
    Feed(Address),
    TokenPool(Address),
    Observation(Address, u32),
}

/// Mirrors `AmmPool::oracle_snapshot` / `sync_oracle` return type.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleSnapshot {
    pub price_cumulative_token: i128,
    pub price_cumulative_quote: i128,
    pub last_timestamp: u64,
    pub last_ledger: u32,
}

/// Mirrors `AmmPool::config` return type.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AmmPoolConfig {
    pub factory: Address,
    pub token: Address,
    pub quote_token: Address,
    pub fee_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Observation {
    pub timestamp: u64,
    pub price_cumulative_token: i128,
    pub price_cumulative_quote: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolFeed {
    pub pool: Address,
    pub token: Address,
    pub quote_token: Address,
    pub cardinality: u32,
    pub index: u32,
    pub count: u32,
    pub min_interval: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TwapResult {
    pub token_price: i128,
    pub quote_price: i128,
    pub window: u64,
    pub timestamp: u64,
}

#[contract]
pub struct TwapOracle;

#[contractimpl]
impl TwapOracle {
    pub fn initialize(e: Env, admin: Address, default_window: u64) {
        if e.storage()
            .instance()
            .has(&DataKey::Config(ConfigKey::Admin))
        {
            panic!("already initialized");
        }
        let window = if default_window == 0 {
            DEFAULT_WINDOW
        } else {
            Self::require_window(default_window)
        };

        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::Admin), &admin);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::DefaultWindow), &window);

        events::emit_initialized(&e, &admin, window);
    }

    pub fn set_default_window(e: Env, window: u64) {
        Self::require_admin(&e);
        let window = Self::require_window(window);
        e.storage()
            .instance()
            .set(&DataKey::Config(ConfigKey::DefaultWindow), &window);
        events::emit_window_set(&e, window);
    }

    pub fn default_window(e: Env) -> u64 {
        e.storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::DefaultWindow))
            .unwrap_or(DEFAULT_WINDOW)
    }

    /// Index an AMM pool as a TWAP source for its base token.
    ///
    /// Observations are stored as a fixed-size ring buffer of individual
    /// persistent keys so storage growth is capped at `cardinality` entries
    /// per pool (old slots are overwritten instead of appending history).
    pub fn register_pool(e: Env, pool: Address, cardinality: u32, min_interval: u32) {
        Self::require_admin(&e);
        if cardinality < MIN_CARDINALITY || cardinality > MAX_CARDINALITY {
            panic!("invalid cardinality");
        }
        if min_interval < MIN_INTERVAL || min_interval > MAX_INTERVAL {
            panic!("invalid min interval");
        }
        if e.storage().persistent().has(&DataKey::Feed(pool.clone())) {
            panic!("pool already registered");
        }

        let config = Self::pool_config(&e, &pool);
        if e.storage()
            .persistent()
            .has(&DataKey::TokenPool(config.token.clone()))
        {
            panic!("token already registered");
        }

        let feed = PoolFeed {
            pool: pool.clone(),
            token: config.token.clone(),
            quote_token: config.quote_token,
            cardinality,
            index: 0,
            count: 0,
            min_interval,
        };
        e.storage()
            .persistent()
            .set(&DataKey::Feed(pool.clone()), &feed);
        e.storage()
            .persistent()
            .set(&DataKey::TokenPool(config.token.clone()), &pool);

        events::emit_pool_registered(&e, &pool, &config.token, cardinality);
        Self::observe(e, pool);
    }

    /// Sync the pool accumulator and record a ring-buffer checkpoint when the
    /// minimum observation interval has elapsed.
    pub fn observe(e: Env, pool: Address) -> bool {
        let snapshot = Self::sync_pool(&e, &pool);
        let mut feed = Self::read_feed(&e, &pool);
        Self::try_record(&e, &mut feed, &snapshot)
    }

    pub fn consult(e: Env, pool: Address, window: u64) -> TwapResult {
        let window = Self::require_window(window);
        let snapshot = Self::sync_pool(&e, &pool);
        let mut feed = Self::read_feed(&e, &pool);
        Self::try_record(&e, &mut feed, &snapshot);
        Self::compute_twap(&e, &feed, &snapshot, window)
    }

    pub fn consult_token(e: Env, token: Address, window: u64) -> i128 {
        let pool = Self::pool_for_token(&e, &token);
        Self::consult(e.clone(), pool, window).token_price
    }

    /// Vault-compatible price of the registered token in quote units (7 decimals).
    pub fn get_price(e: Env, token: Address) -> i128 {
        let window = Self::default_window(e.clone());
        Self::consult_token(e, token, window)
    }

    pub fn has_twap(e: Env, token: Address) -> bool {
        let window = Self::default_window(e.clone());
        Self::has_twap_window(e, token, window)
    }

    pub fn has_twap_window(e: Env, token: Address, window: u64) -> bool {
        let pool = match e
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::TokenPool(token))
        {
            Some(pool) => pool,
            None => return false,
        };
        let feed = match e
            .storage()
            .persistent()
            .get::<_, PoolFeed>(&DataKey::Feed(pool))
        {
            Some(feed) => feed,
            None => return false,
        };
        if feed.count == 0 {
            return false;
        }
        let oldest = Self::read_observation(&e, &feed.pool, Self::oldest_index(&feed));
        e.ledger().timestamp().saturating_sub(oldest.timestamp) >= window
    }

    pub fn get_feed(e: Env, pool: Address) -> PoolFeed {
        Self::read_feed(&e, &pool)
    }

    pub fn get_pool(e: Env, token: Address) -> Address {
        Self::pool_for_token(&e, &token)
    }

    pub fn get_observation(e: Env, pool: Address, index: u32) -> Observation {
        let feed = Self::read_feed(&e, &pool);
        if index >= feed.cardinality {
            panic!("observation index out of range");
        }
        Self::read_observation(&e, &pool, index)
    }

    pub fn version(e: Env) -> String {
        String::from_str(&e, "1.0.0")
    }

    pub fn status(e: Env) -> String {
        String::from_str(&e, "alive")
    }
}

impl TwapOracle {
    fn require_admin(e: &Env) {
        let admin: Address = e
            .storage()
            .instance()
            .get(&DataKey::Config(ConfigKey::Admin))
            .expect("not initialized");
        admin.require_auth();
    }

    fn require_window(window: u64) -> u64 {
        if window < MIN_WINDOW || window > MAX_WINDOW {
            panic!("invalid window");
        }
        window
    }

    fn read_feed(e: &Env, pool: &Address) -> PoolFeed {
        e.storage()
            .persistent()
            .get(&DataKey::Feed(pool.clone()))
            .expect("pool not registered")
    }

    fn pool_for_token(e: &Env, token: &Address) -> Address {
        e.storage()
            .persistent()
            .get(&DataKey::TokenPool(token.clone()))
            .expect("token has no twap feed")
    }

    fn pool_config(e: &Env, pool: &Address) -> AmmPoolConfig {
        e.invoke_contract::<AmmPoolConfig>(pool, &Symbol::new(e, "config"), Vec::new(e))
    }

    fn sync_pool(e: &Env, pool: &Address) -> OracleSnapshot {
        e.invoke_contract::<OracleSnapshot>(pool, &Symbol::new(e, "sync_oracle"), Vec::new(e))
    }

    fn oldest_index(feed: &PoolFeed) -> u32 {
        if feed.count < feed.cardinality {
            0
        } else {
            feed.index
        }
    }

    fn last_index(feed: &PoolFeed) -> u32 {
        (feed.index + feed.cardinality - 1) % feed.cardinality
    }

    fn physical_index(oldest: u32, logical: u32, cardinality: u32) -> u32 {
        (oldest + logical) % cardinality
    }

    fn read_observation(e: &Env, pool: &Address, index: u32) -> Observation {
        e.storage()
            .persistent()
            .get(&DataKey::Observation(pool.clone(), index))
            .expect("observation missing")
    }

    fn try_record(e: &Env, feed: &mut PoolFeed, snapshot: &OracleSnapshot) -> bool {
        if feed.count > 0 {
            let last = Self::read_observation(e, &feed.pool, Self::last_index(feed));
            if snapshot.last_timestamp.saturating_sub(last.timestamp) < feed.min_interval as u64 {
                return false;
            }
        }

        let observation = Observation {
            timestamp: snapshot.last_timestamp,
            price_cumulative_token: snapshot.price_cumulative_token,
            price_cumulative_quote: snapshot.price_cumulative_quote,
        };
        let written_at = feed.index;
        e.storage().persistent().set(
            &DataKey::Observation(feed.pool.clone(), written_at),
            &observation,
        );

        feed.index = (feed.index + 1) % feed.cardinality;
        if feed.count < feed.cardinality {
            feed.count += 1;
        }
        e.storage()
            .persistent()
            .set(&DataKey::Feed(feed.pool.clone()), feed);

        events::emit_observed(
            e,
            &feed.pool,
            observation.timestamp,
            written_at,
            observation.price_cumulative_token,
        );
        true
    }

    fn compute_twap(e: &Env, feed: &PoolFeed, live: &OracleSnapshot, window: u64) -> TwapResult {
        if feed.count == 0 {
            panic!("insufficient observation history");
        }

        let now = live.last_timestamp;
        if now < window {
            panic!("insufficient observation history");
        }
        let target = now - window;
        let start = Self::observe_at(e, feed, live, target);
        let elapsed = (now - target) as i128;
        if elapsed <= 0 {
            panic!("insufficient observation history");
        }

        let token_price = live
            .price_cumulative_token
            .checked_sub(start.price_cumulative_token)
            .expect("token twap underflow")
            .checked_div(elapsed)
            .expect("token twap division failed");
        let quote_price = live
            .price_cumulative_quote
            .checked_sub(start.price_cumulative_quote)
            .expect("quote twap underflow")
            .checked_div(elapsed)
            .expect("quote twap division failed");

        if token_price <= 0 || quote_price <= 0 {
            panic!("invalid twap");
        }

        TwapResult {
            token_price,
            quote_price,
            window,
            timestamp: now,
        }
    }

    fn observe_at(e: &Env, feed: &PoolFeed, live: &OracleSnapshot, target: u64) -> Observation {
        let oldest = Self::read_observation(e, &feed.pool, Self::oldest_index(feed));
        if target < oldest.timestamp {
            panic!("insufficient observation history");
        }
        if target >= live.last_timestamp {
            return Observation {
                timestamp: live.last_timestamp,
                price_cumulative_token: live.price_cumulative_token,
                price_cumulative_quote: live.price_cumulative_quote,
            };
        }

        let before_logical = Self::latest_logical_at_or_before(e, feed, target);
        let before = Self::read_observation(
            e,
            &feed.pool,
            Self::physical_index(Self::oldest_index(feed), before_logical, feed.cardinality),
        );
        if before.timestamp == target {
            return before;
        }

        let after = if before_logical + 1 < feed.count {
            Self::read_observation(
                e,
                &feed.pool,
                Self::physical_index(
                    Self::oldest_index(feed),
                    before_logical + 1,
                    feed.cardinality,
                ),
            )
        } else {
            Observation {
                timestamp: live.last_timestamp,
                price_cumulative_token: live.price_cumulative_token,
                price_cumulative_quote: live.price_cumulative_quote,
            }
        };

        Self::interpolate(&before, &after, target)
    }

    fn latest_logical_at_or_before(e: &Env, feed: &PoolFeed, target: u64) -> u32 {
        let oldest = Self::oldest_index(feed);
        let mut left: u32 = 0;
        let mut right = feed.count;

        while left < right {
            let mid = left + (right - left) / 2;
            let obs = Self::read_observation(
                e,
                &feed.pool,
                Self::physical_index(oldest, mid, feed.cardinality),
            );
            if obs.timestamp <= target {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        if left == 0 {
            panic!("insufficient observation history");
        }
        left - 1
    }

    fn interpolate(before: &Observation, after: &Observation, target: u64) -> Observation {
        if after.timestamp <= before.timestamp {
            return before.clone();
        }

        let span = (after.timestamp - before.timestamp) as i128;
        let elapsed = (target - before.timestamp) as i128;

        Observation {
            timestamp: target,
            price_cumulative_token: Self::lerp(
                before.price_cumulative_token,
                after.price_cumulative_token,
                elapsed,
                span,
            ),
            price_cumulative_quote: Self::lerp(
                before.price_cumulative_quote,
                after.price_cumulative_quote,
                elapsed,
                span,
            ),
        }
    }

    fn lerp(start: i128, end: i128, elapsed: i128, span: i128) -> i128 {
        let delta = end
            .checked_sub(start)
            .expect("cumulative interpolation underflow");
        start
            .checked_add(
                delta
                    .checked_mul(elapsed)
                    .expect("cumulative interpolation overflow")
                    .checked_div(span)
                    .expect("cumulative interpolation division failed"),
            )
            .expect("cumulative interpolation addition overflow")
    }
}
