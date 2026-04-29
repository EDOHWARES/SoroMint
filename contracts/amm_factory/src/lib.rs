#![no_std]

mod factory;

pub use crate::factory::{AmmFactory, AmmFactoryClient, AmmFactoryConfig};

#[cfg(test)]
mod test_factory;
