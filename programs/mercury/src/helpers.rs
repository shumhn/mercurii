use anchor_lang::prelude::*;

use crate::constants::BRANCH_SCOPE_SEED;
use crate::errors::MercuryError;

pub(crate) fn request_branch_scope(company: Pubkey, request_id: u64) -> Result<Pubkey> {
    let branch = request_id >> 40;
    require!(branch > 0, MercuryError::InvalidScope);
    let bytes = (branch as u32).to_le_bytes();
    Ok(Pubkey::find_program_address(
        &[BRANCH_SCOPE_SEED, company.as_ref(), &bytes[..3]],
        &crate::ID,
    )
    .0)
}
