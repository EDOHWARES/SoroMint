#![no_std]

mod events;
mod oracle;
mod pool;

pub use crate::oracle::{OracleSnapshot, SpotPrices, PRICE_SCALE};
pub use crate::pool::{
    AmmPool, AmmPoolClient, LiquidityPosition, PoolConfig, PoolReserves, SwapQuote, SwapResult,
};

#[cfg(test)]
mod test_pool;
