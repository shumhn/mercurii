use anchor_lang::prelude::*;

#[error_code]
pub enum MercuryError {
    #[msg("Signer does not have this company permission")]
    Unauthorized,
    #[msg("Team member address is invalid")]
    InvalidMember,
    #[msg("Team grant is missing")]
    MissingGrant,
    #[msg("Team grant does not match the requested authority")]
    InvalidGrant,
    #[msg("Team or branch scope is invalid")]
    InvalidScope,
    #[msg("A grant already has the maximum number of child readers")]
    TooManyMembers,
    #[msg("A member already reads the parent grant")]
    DuplicateMember,
    #[msg("Finance wallet cannot be the default address")]
    InvalidFinance,
    #[msg("Invalid token mint")]
    InvalidMint,
    #[msg("Private permission must be active before writing limits")]
    PrivacyNotActive,
    #[msg("Private permission is already active")]
    PrivacyAlreadyActive,
    #[msg("Limit must be positive and the agent cap cannot exceed it")]
    InvalidLimit,
    #[msg("Policy version overflow")]
    Overflow,
    #[msg("Request belongs to another company")]
    WrongCompany,
    #[msg("Request is in the wrong state")]
    WrongStatus,
    #[msg("Invalid recipient")]
    InvalidRecipient,
    #[msg("Amount must be positive")]
    InvalidAmount,
    #[msg("Company budget exceeded")]
    BudgetExceeded,
    #[msg("Approval expired at period boundary")]
    ApprovalExpired,
    #[msg("Wrong source token authority")]
    WrongTokenOwner,
    #[msg("Invalid agent signer")]
    InvalidAgent,
    #[msg("Agent is revoked")]
    AgentRevoked,
    #[msg("Expected the canonical company token account")]
    WrongTokenAccount,
}
