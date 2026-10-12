use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use ephemeral_rollups_sdk::{
    access_control::structs::PERMISSION_SEED,
    anchor::delegate,
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
};

use crate::constants::*;
use crate::errors::MercuryError;
use crate::state::*;

#[derive(Accounts)]
pub struct InitializeCompany<'info> {
    #[account(
        init,
        payer = founder,
        space = 8 + CompanyPolicy::LEN,
        seeds = [POLICY_SEED, founder.key().as_ref()],
        bump,
    )]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(mut)]
    pub founder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegatePolicy<'info> {
    pub founder: Signer<'info>,
    /// CHECK: PDA derivation and delegated ownership are checked by the SDK.
    #[account(mut, del, seeds = [POLICY_SEED, founder.key().as_ref()], bump)]
    pub policy: UncheckedAccount<'info>,
    /// CHECK: A validator pubkey chosen for this devnet proof.
    pub validator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct PermissionContext<'info> {
    #[account(mut)]
    pub founder: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, policy.founder.as_ref()],
        has_one = founder,
        bump,
    )]
    pub policy: Account<'info, CompanyPolicy>,
    /// CHECK: PDA is checked against the MagicBlock Permission Program.
    #[account(
        mut,
        seeds = [PERMISSION_SEED, policy.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Fixed program address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: Fixed ephemeral vault address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Fixed Magic Program address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ConfigureLimits<'info> {
    pub founder: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, policy.founder.as_ref()],
        has_one = founder,
        bump,
    )]
    pub policy: Account<'info, CompanyPolicy>,
}

#[derive(Accounts)]
#[instruction(company: Pubkey, member: Pubkey, id: u64)]
pub struct CreateGrantShell<'info> {
    #[account(
        init,
        payer = grantor,
        space = 8 + TeamGrant::LEN,
        seeds = [GRANT_SEED, company.as_ref(), grantor.key().as_ref(), member.as_ref(), &id.to_le_bytes()],
        bump,
    )]
    pub grant: Account<'info, TeamGrant>,
    #[account(mut)]
    pub grantor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(company: Pubkey, member: Pubkey, id: u64)]
pub struct DelegateGrant<'info> {
    pub grantor: Signer<'info>,
    /// CHECK: PDA derivation and delegation are checked by the SDK.
    #[account(mut, del, seeds = [GRANT_SEED, company.as_ref(), grantor.key().as_ref(), member.as_ref(), &id.to_le_bytes()], bump)]
    pub grant: UncheckedAccount<'info>,
    /// CHECK: selected TEE validator.
    pub validator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct GrantPermissionContext<'info> {
    pub grantor: Signer<'info>,
    #[account(mut, seeds = [GRANT_SEED, grant.company.as_ref(), grant.grantor.as_ref(), grant.member.as_ref(), &grant.id.to_le_bytes()], has_one = grantor, bump)]
    pub grant: Account<'info, TeamGrant>,
    /// CHECK: MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, grant.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: fixed permission program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed ephemeral vault.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed Magic Program.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ActivateRootGrantPrivacy<'info> {
    pub founder: Signer<'info>,
    #[account(mut, seeds = [POLICY_SEED, policy.founder.as_ref()], has_one = founder, bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(mut, seeds = [GRANT_SEED, grant.company.as_ref(), grant.grantor.as_ref(), grant.member.as_ref(), &grant.id.to_le_bytes()], bump)]
    pub grant: Account<'info, TeamGrant>,
    /// CHECK: MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, grant.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Company policy's MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, policy.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub policy_permission: UncheckedAccount<'info>,
    /// CHECK: fixed permission program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed ephemeral vault.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed Magic Program.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ActivateChildGrantPrivacy<'info> {
    pub grantor: Signer<'info>,
    #[account(mut, seeds = [POLICY_SEED, policy.founder.as_ref()], bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(mut, seeds = [GRANT_SEED, grant.company.as_ref(), grant.grantor.as_ref(), grant.member.as_ref(), &grant.id.to_le_bytes()], has_one = grantor, bump)]
    pub grant: Account<'info, TeamGrant>,
    #[account(mut, seeds = [GRANT_SEED, parent.company.as_ref(), parent.grantor.as_ref(), parent.member.as_ref(), &parent.id.to_le_bytes()], bump)]
    pub parent: Account<'info, TeamGrant>,
    /// CHECK: MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, grant.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Parent MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, parent.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub parent_permission: UncheckedAccount<'info>,
    /// CHECK: Company policy's MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, policy.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub policy_permission: UncheckedAccount<'info>,
    /// CHECK: fixed permission program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed ephemeral vault.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed Magic Program.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ConfigureGrant<'info> {
    pub grantor: Signer<'info>,
    #[account(seeds = [POLICY_SEED, policy.founder.as_ref()], bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(mut, seeds = [GRANT_SEED, grant.company.as_ref(), grant.grantor.as_ref(), grant.member.as_ref(), &grant.id.to_le_bytes()], has_one = grantor, constraint = grant.company == policy.key() @ MercuryError::WrongCompany, bump)]
    pub grant: Account<'info, TeamGrant>,
    #[account(seeds = [GRANT_SEED, parent.company.as_ref(), parent.grantor.as_ref(), parent.member.as_ref(), &parent.id.to_le_bytes()], bump)]
    pub parent: Option<Account<'info, TeamGrant>>,
}

#[derive(Accounts)]
pub struct RevokeGrant<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [POLICY_SEED, policy.founder.as_ref()], bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(mut, seeds = [GRANT_SEED, grant.company.as_ref(), grant.grantor.as_ref(), grant.member.as_ref(), &grant.id.to_le_bytes()], constraint = grant.company == policy.key() @ MercuryError::WrongCompany, bump)]
    pub grant: Account<'info, TeamGrant>,
    #[account(mut, seeds = [GRANT_SEED, parent.company.as_ref(), parent.grantor.as_ref(), parent.member.as_ref(), &parent.id.to_le_bytes()], bump)]
    pub parent: Option<Account<'info, TeamGrant>>,
    /// CHECK: MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, grant.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Parent MagicBlock permission PDA, required for child revocation.
    #[account(mut)]
    pub parent_permission: Option<UncheckedAccount<'info>>,
    /// CHECK: Company policy's MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, policy.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub policy_permission: UncheckedAccount<'info>,
    /// CHECK: fixed permission program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed ephemeral vault.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed Magic Program.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(company: Pubkey)]
pub struct CreateSnapshotShell<'info> {
    #[account(
        init,
        payer = founder,
        space = 8 + TreasurySnapshot::LEN,
        seeds = [SNAPSHOT_SEED, company.as_ref()],
        bump,
    )]
    pub snapshot: Account<'info, TreasurySnapshot>,
    #[account(mut)]
    pub founder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(company: Pubkey)]
pub struct DelegateSnapshot<'info> {
    pub founder: Signer<'info>,
    /// CHECK: PDA derivation is checked by the SDK.
    #[account(mut, del, seeds = [SNAPSHOT_SEED, company.as_ref()], bump)]
    pub snapshot: UncheckedAccount<'info>,
    /// CHECK: selected TEE validator.
    pub validator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SnapshotPermissionContext<'info> {
    pub founder: Signer<'info>,
    #[account(mut, seeds = [SNAPSHOT_SEED, snapshot.company.as_ref()], has_one = founder, bump)]
    pub snapshot: Account<'info, TreasurySnapshot>,
    /// CHECK: MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, snapshot.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed vault address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ActivateSnapshotPrivacy<'info> {
    pub founder: Signer<'info>,
    #[account(seeds = [POLICY_SEED, policy.founder.as_ref()], has_one = founder, bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(mut, seeds = [SNAPSHOT_SEED, snapshot.company.as_ref()], has_one = founder, bump)]
    pub snapshot: Account<'info, TreasurySnapshot>,
    /// CHECK: MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, snapshot.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed vault address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SyncTreasurySnapshot<'info> {
    pub actor: Signer<'info>,
    #[account(seeds = [POLICY_SEED, policy.founder.as_ref()], bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(mut, seeds = [SNAPSHOT_SEED, policy.key().as_ref()], bump)]
    pub snapshot: Account<'info, TreasurySnapshot>,
    #[account(seeds = [GRANT_SEED, grant.company.as_ref(), grant.grantor.as_ref(), grant.member.as_ref(), &grant.id.to_le_bytes()], bump)]
    pub grant: Option<Account<'info, TeamGrant>>,
    pub treasury_token: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
#[instruction(company: Pubkey, id: u64)]
pub struct CreateRequestShell<'info> {
    #[account(
        init,
        payer = requester,
        space = 8 + PaymentRequest::LEN,
        seeds = [REQUEST_SEED, company.as_ref(), requester.key().as_ref(), &id.to_le_bytes()],
        bump,
    )]
    pub request: Account<'info, PaymentRequest>,
    #[account(mut)]
    pub requester: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(company: Pubkey, id: u64)]
pub struct DelegateRequest<'info> {
    pub requester: Signer<'info>,
    /// CHECK: PDA seeds bind the request to the requester who created it.
    #[account(mut, del, seeds = [REQUEST_SEED, company.as_ref(), requester.key().as_ref(), &id.to_le_bytes()], bump)]
    pub request: UncheckedAccount<'info>,
    /// CHECK: validator chosen for devnet; client must match the policy's ER.
    pub validator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RequestPermissionContext<'info> {
    pub requester: Signer<'info>,
    #[account(
        mut,
        seeds = [REQUEST_SEED, request.company.as_ref(), request.requester.as_ref(), &request.id.to_le_bytes()],
        has_one = requester,
        bump,
    )]
    pub request: Account<'info, PaymentRequest>,
    /// CHECK: MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, request.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed vault address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ActivateRequestPrivacy<'info> {
    pub founder: Signer<'info>,
    #[account(seeds = [POLICY_SEED, policy.founder.as_ref()], has_one = founder, bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(
        mut,
        seeds = [REQUEST_SEED, request.company.as_ref(), request.requester.as_ref(), &request.id.to_le_bytes()],
        bump,
    )]
    pub request: Account<'info, PaymentRequest>,
    #[account(seeds = [GRANT_SEED, requester_grant.company.as_ref(), requester_grant.grantor.as_ref(), requester_grant.member.as_ref(), &requester_grant.id.to_le_bytes()], bump)]
    pub requester_grant: Option<Account<'info, TeamGrant>>,
    /// CHECK: MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, request.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed vault address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetRequestReadersV2<'info> {
    pub founder: Signer<'info>,
    #[account(seeds = [POLICY_SEED, policy.founder.as_ref()], has_one = founder, bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(mut, seeds = [REQUEST_SEED, request.company.as_ref(), request.requester.as_ref(), &request.id.to_le_bytes()], bump)]
    pub request: Account<'info, PaymentRequest>,
    #[account(seeds = [GRANT_SEED, viewer_grant.company.as_ref(), viewer_grant.grantor.as_ref(), viewer_grant.member.as_ref(), &viewer_grant.id.to_le_bytes()], bump)]
    pub viewer_grant: Option<Account<'info, TeamGrant>>,
    /// CHECK: MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, request.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed vault address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SubmitPayment<'info> {
    pub requester: Signer<'info>,
    #[account(seeds = [POLICY_SEED, policy.founder.as_ref()], bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(
        mut,
        seeds = [REQUEST_SEED, request.company.as_ref(), requester.key().as_ref(), &request.id.to_le_bytes()],
        has_one = requester,
        bump,
    )]
    pub request: Account<'info, PaymentRequest>,
    #[account(seeds = [GRANT_SEED, requester_grant.company.as_ref(), requester_grant.grantor.as_ref(), requester_grant.member.as_ref(), &requester_grant.id.to_le_bytes()], bump)]
    pub requester_grant: Option<Account<'info, TeamGrant>>,
}

#[derive(Accounts)]
pub struct ApprovePayment<'info> {
    pub actor: Signer<'info>,
    #[account(mut, seeds = [POLICY_SEED, policy.founder.as_ref()], bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(mut, constraint = request.company == policy.key() @ MercuryError::WrongCompany)]
    pub request: Account<'info, PaymentRequest>,
    #[account(mut, seeds = [GRANT_SEED, grant.company.as_ref(), grant.grantor.as_ref(), grant.member.as_ref(), &grant.id.to_le_bytes()], bump)]
    pub grant: Option<Account<'info, TeamGrant>>,
    #[account(seeds = [GRANT_SEED, parent_grant.company.as_ref(), parent_grant.grantor.as_ref(), parent_grant.member.as_ref(), &parent_grant.id.to_le_bytes()], bump)]
    pub parent_grant: Option<Account<'info, TeamGrant>>,
}

#[derive(Accounts)]
pub struct ExecutePayment<'info> {
    pub actor: Signer<'info>,
    #[account(mut, seeds = [POLICY_SEED, policy.founder.as_ref()], bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(mut, constraint = request.company == policy.key() @ MercuryError::WrongCompany)]
    pub request: Account<'info, PaymentRequest>,
    #[account(mut, seeds = [GRANT_SEED, grant.company.as_ref(), grant.grantor.as_ref(), grant.member.as_ref(), &grant.id.to_le_bytes()], bump)]
    pub grant: Option<Account<'info, TeamGrant>>,
    #[account(mut)]
    pub treasury_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub recipient_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(company: Pubkey, agent: Pubkey)]
pub struct CreateAgentShell<'info> {
    #[account(mut)]
    pub founder: Signer<'info>,
    #[account(
        init,
        payer = founder,
        space = 8 + AgentPolicy::LEN,
        seeds = [AGENT_SEED, founder.key().as_ref(), company.as_ref(), agent.as_ref()],
        bump,
    )]
    pub agent_policy: Account<'info, AgentPolicy>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(company: Pubkey, agent: Pubkey)]
pub struct DelegateAgent<'info> {
    pub founder: Signer<'info>,
    /// CHECK: PDA seeds bind this account to the founder.
    #[account(mut, del, seeds = [AGENT_SEED, founder.key().as_ref(), company.as_ref(), agent.as_ref()], bump)]
    pub agent_policy: UncheckedAccount<'info>,
    /// CHECK: selected TEE validator; client checks co-location.
    pub validator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AgentPermissionContext<'info> {
    pub founder: Signer<'info>,
    #[account(
        mut,
        seeds = [AGENT_SEED, agent_policy.founder.as_ref(), agent_policy.company.as_ref(), agent_policy.agent.as_ref()],
        has_one = founder,
        bump,
    )]
    pub agent_policy: Account<'info, AgentPolicy>,
    /// CHECK: MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, agent_policy.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed vault address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ActivateAgentPrivacy<'info> {
    pub founder: Signer<'info>,
    #[account(seeds = [POLICY_SEED, policy.founder.as_ref()], has_one = founder, bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(
        mut,
        seeds = [AGENT_SEED, agent_policy.founder.as_ref(), agent_policy.company.as_ref(), agent_policy.agent.as_ref()],
        has_one = founder,
        bump,
    )]
    pub agent_policy: Account<'info, AgentPolicy>,
    /// CHECK: MagicBlock permission PDA.
    #[account(mut, seeds = [PERMISSION_SEED, agent_policy.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed vault address.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed program address.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ConfigureAgent<'info> {
    pub founder: Signer<'info>,
    #[account(
        mut,
        seeds = [AGENT_SEED, agent_policy.founder.as_ref(), agent_policy.company.as_ref(), agent_policy.agent.as_ref()],
        has_one = founder,
        bump,
    )]
    pub agent_policy: Account<'info, AgentPolicy>,
}

#[derive(Accounts)]
pub struct FundAgentFloat<'info> {
    pub founder: Signer<'info>,
    #[account(mut, seeds = [POLICY_SEED, policy.founder.as_ref()], has_one = founder, bump)]
    pub policy: Account<'info, CompanyPolicy>,
    #[account(
        mut,
        seeds = [AGENT_SEED, agent_policy.founder.as_ref(), agent_policy.company.as_ref(), agent_policy.agent.as_ref()],
        constraint = agent_policy.company == policy.key() @ MercuryError::WrongCompany,
        bump,
    )]
    pub agent_policy: Account<'info, AgentPolicy>,
    #[account(mut)]
    pub treasury_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub agent_float_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AgentPay<'info> {
    pub agent: Signer<'info>,
    #[account(
        mut,
        seeds = [AGENT_SEED, agent_policy.founder.as_ref(), agent_policy.company.as_ref(), agent_policy.agent.as_ref()],
        has_one = agent,
        bump,
    )]
    pub agent_policy: Account<'info, AgentPolicy>,
    #[account(mut)]
    pub agent_float_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub recipient_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
