use anchor_lang::prelude::*;

use crate::constants::{MAX_GRANT_READERS, MAX_GRANT_RECIPIENTS};
use crate::errors::MercuryError;

#[account]
pub struct TeamGrant {
    pub company: Pubkey,
    pub grantor: Pubkey,
    pub member: Pubkey,
    pub id: u64,
    pub parent: Pubkey,
    pub scope: Pubkey,
    pub role: u8,
    pub private_ready: bool,
    pub active: bool,
    pub revoked: bool,
    pub may_delegate: bool,
    pub per_payment_cap_micro: u64,
    pub period_cap_micro: u64,
    pub period: i64,
    pub spent_micro: u64,
    pub approved_micro: u64,
    pub recipients: Vec<Pubkey>,
    pub child_readers: Vec<Pubkey>,
}

impl TeamGrant {
    pub const LEN: usize =
        32 * 5 + 8 + 5 + 8 * 4 + 4 + 32 * MAX_GRANT_RECIPIENTS + 4 + 32 * MAX_GRANT_READERS;

    pub(crate) fn check_payment(&self, recipient: Pubkey, amount: u64) -> Result<()> {
        require!(
            self.private_ready && self.active && !self.revoked,
            MercuryError::Unauthorized
        );
        require!(
            self.recipients.contains(&recipient),
            MercuryError::InvalidRecipient
        );
        require!(
            amount > 0 && amount <= self.per_payment_cap_micro,
            MercuryError::BudgetExceeded
        );
        Ok(())
    }
}

#[account]
pub struct AgentPolicy {
    pub company: Pubkey,
    pub founder: Pubkey,
    pub finance: Pubkey,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub private_ready: bool,
    pub revoked: bool,
    pub allowed_recipient: Pubkey,
    pub per_payment_cap_micro: u64,
    pub period_cap_micro: u64,
    pub period: i64,
    pub spent_micro: u64,
}

impl AgentPolicy {
    pub const LEN: usize = 32 * 6 + 2 + 8 * 4;
}

#[account]
pub struct PaymentRequest {
    pub company: Pubkey,
    pub requester: Pubkey,
    pub id: u64,
    pub private_ready: bool,
    pub recipient: Pubkey,
    pub amount_micro: u64,
    pub status: u8,
    pub approved_period: i64,
}

impl PaymentRequest {
    pub const LEN: usize = 32 + 32 + 8 + 1 + 32 + 8 + 1 + 8;
}

#[account]
pub struct CompanyPolicy {
    pub founder: Pubkey,
    pub finance: Pubkey,
    pub mint: Pubkey,
    pub private_ready: bool,
    pub monthly_limit_micro: u64,
    pub agent_cap_micro: u64,
    pub period: i64,
    pub spent_micro: u64,
    pub reserved_micro: u64,
    pub version: u64,
}

impl CompanyPolicy {
    pub const LEN: usize = 32 + 32 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 8;
}

#[account]
pub struct TreasurySnapshot {
    pub company: Pubkey,
    pub founder: Pubkey,
    pub finance: Pubkey,
    pub mint: Pubkey,
    pub private_ready: bool,
    pub balance_micro: u64,
    pub updated_slot: u64,
}

impl TreasurySnapshot {
    pub const LEN: usize = 32 * 4 + 1 + 8 + 8;
}
