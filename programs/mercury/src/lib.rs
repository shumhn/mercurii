use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token::{self, Token, TokenAccount, Transfer as SplTransfer};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::{CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi},
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, PERMISSION_SEED, TX_BALANCES_FLAG,
            TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::{delegate, ephemeral},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
};

declare_id!("34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L");

const POLICY_SEED: &[u8] = b"company-policy";
const REQUEST_SEED: &[u8] = b"payment-request";
const AGENT_SEED: &[u8] = b"agent-policy";
const SNAPSHOT_SEED: &[u8] = b"treasury-snapshot";
const GRANT_SEED: &[u8] = b"team-grant";
const BRANCH_SCOPE_SEED: &[u8] = b"branch-scope";
const ROLE_FINANCE: u8 = 1;
const ROLE_MANAGER: u8 = 2;
const ROLE_REQUESTER: u8 = 3;
const ROLE_VIEWER: u8 = 4;
const MAX_GRANT_RECIPIENTS: usize = 16;
const MAX_GRANT_READERS: usize = 8;
const PERIOD_SECONDS: i64 = 30 * 24 * 60 * 60;
const STATUS_EMPTY: u8 = 0;
const STATUS_SUBMITTED: u8 = 1;
const STATUS_APPROVED: u8 = 2;
const STATUS_EXECUTED: u8 = 3;
const STATUS_REJECTED: u8 = 4;

fn request_branch_scope(company: Pubkey, request_id: u64) -> Result<Pubkey> {
    let branch = request_id >> 40;
    require!(branch > 0, MercuryError::InvalidScope);
    let bytes = (branch as u32).to_le_bytes();
    Ok(Pubkey::find_program_address(
        &[BRANCH_SCOPE_SEED, company.as_ref(), &bytes[..3]],
        &crate::ID,
    )
    .0)
}

#[ephemeral]
#[program]
pub mod mercury {
    use super::*;

    /// Base-layer creation writes only non-confidential membership and zero limits.
    /// The extra lamports sponsor the ER-local permission account after delegation.
    pub fn initialize_company(
        ctx: Context<InitializeCompany>,
        finance: Pubkey,
        mint: Pubkey,
    ) -> Result<()> {
        require!(finance != Pubkey::default(), MercuryError::InvalidFinance);
        require!(mint != Pubkey::default(), MercuryError::InvalidMint);
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.founder.to_account_info(),
                    to: ctx.accounts.policy.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(
                2 + MAX_GRANT_READERS,
            ) as u32),
        )?;

        let policy = &mut ctx.accounts.policy;
        policy.founder = ctx.accounts.founder.key();
        policy.finance = finance;
        policy.mint = mint;
        policy.private_ready = false;
        policy.monthly_limit_micro = 0;
        policy.agent_cap_micro = 0;
        policy.period = 0;
        policy.spent_micro = 0;
        policy.reserved_micro = 0;
        policy.version = 0;
        Ok(())
    }

    /// Submit on Solana base. Resolve the TEE validator from deployment config;
    /// the resulting ER endpoint is discovered through the MagicBlock router.
    pub fn delegate_policy(ctx: Context<DelegatePolicy>) -> Result<()> {
        let founder = ctx.accounts.founder.key();
        ctx.accounts.delegate_policy(
            &ctx.accounts.founder,
            &[POLICY_SEED, founder.as_ref()],
            DelegateConfig {
                validator: Some(ctx.accounts.validator.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Run on the selected ER, then call activate_privacy before any limit is set.
    pub fn init_permission(ctx: Context<PermissionContext>) -> Result<()> {
        let bump = [ctx.bumps.policy];
        let seeds: &[&[u8]] = &[POLICY_SEED, ctx.accounts.policy.founder.as_ref(), &bump];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.policy.to_account_info(),
            permissioned_account: ctx.accounts.policy.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members: vec![],
            },
        }
        .invoke_signed(&[&seeds])?;
        Ok(())
    }

    /// Make state private to Founder and Finance. The CPI and readiness flag
    /// share a transaction: if the permission update fails, readiness stays false.
    pub fn activate_privacy(ctx: Context<PermissionContext>) -> Result<()> {
        require!(
            !ctx.accounts.policy.private_ready,
            MercuryError::PrivacyAlreadyActive
        );
        let founder = ctx.accounts.policy.founder;
        let finance = ctx.accounts.policy.finance;
        let bump = [ctx.bumps.policy];
        let seeds: &[&[u8]] = &[POLICY_SEED, ctx.accounts.policy.founder.as_ref(), &bump];
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.policy.to_account_info(),
            permissioned_account: ctx.accounts.policy.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.policy.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![
                    Member {
                        flags,
                        pubkey: founder,
                    },
                    Member {
                        flags,
                        pubkey: finance,
                    },
                ],
            },
        }
        .invoke_signed(&[&seeds])?;
        ctx.accounts.policy.private_ready = true;
        Ok(())
    }

    /// The first confidential mutation is impossible until privacy is active.
    /// These limits are policy data only; this proof does not move USDC.
    pub fn configure_limits(
        ctx: Context<ConfigureLimits>,
        monthly_limit_micro: u64,
        agent_cap_micro: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(monthly_limit_micro > 0, MercuryError::InvalidLimit);
        require!(
            agent_cap_micro <= monthly_limit_micro,
            MercuryError::InvalidLimit
        );
        let period = Clock::get()?.unix_timestamp.div_euclid(PERIOD_SECONDS);
        if ctx.accounts.policy.period == period {
            let committed = ctx
                .accounts
                .policy
                .spent_micro
                .checked_add(ctx.accounts.policy.reserved_micro)
                .ok_or(MercuryError::Overflow)?;
            require!(
                committed <= monthly_limit_micro,
                MercuryError::BudgetExceeded
            );
        }
        let policy = &mut ctx.accounts.policy;
        policy.monthly_limit_micro = monthly_limit_micro;
        policy.agent_cap_micro = agent_cap_micro;
        policy.version = policy
            .version
            .checked_add(1)
            .ok_or(MercuryError::Overflow)?;
        Ok(())
    }

    /// A public, zero-authority shell. The grant's recipient list and caps are
    /// populated only after delegation and the PER privacy permission are live.
    pub fn create_grant_shell(
        ctx: Context<CreateGrantShell>,
        company: Pubkey,
        member: Pubkey,
        id: u64,
    ) -> Result<()> {
        require!(member != Pubkey::default(), MercuryError::InvalidMember);
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.grantor.to_account_info(),
                    to: ctx.accounts.grant.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(
                3 + MAX_GRANT_READERS,
            ) as u32),
        )?;
        let grant = &mut ctx.accounts.grant;
        grant.company = company;
        grant.grantor = ctx.accounts.grantor.key();
        grant.member = member;
        grant.id = id;
        grant.parent = Pubkey::default();
        grant.scope = Pubkey::default();
        grant.role = 0;
        grant.private_ready = false;
        grant.active = false;
        grant.revoked = false;
        grant.may_delegate = false;
        grant.per_payment_cap_micro = 0;
        grant.period_cap_micro = 0;
        grant.period = 0;
        grant.spent_micro = 0;
        grant.approved_micro = 0;
        grant.recipients = Vec::new();
        grant.child_readers = Vec::new();
        Ok(())
    }

    pub fn delegate_grant(
        ctx: Context<DelegateGrant>,
        company: Pubkey,
        member: Pubkey,
        id: u64,
    ) -> Result<()> {
        let grantor = ctx.accounts.grantor.key();
        let id_bytes = id.to_le_bytes();
        ctx.accounts.delegate_grant(
            &ctx.accounts.grantor,
            &[
                GRANT_SEED,
                company.as_ref(),
                grantor.as_ref(),
                member.as_ref(),
                &id_bytes,
            ],
            DelegateConfig {
                validator: Some(ctx.accounts.validator.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn init_grant_permission(ctx: Context<GrantPermissionContext>) -> Result<()> {
        let id_bytes = ctx.accounts.grant.id.to_le_bytes();
        let bump = [ctx.bumps.grant];
        let seeds: &[&[u8]] = &[
            GRANT_SEED,
            ctx.accounts.grant.company.as_ref(),
            ctx.accounts.grant.grantor.as_ref(),
            ctx.accounts.grant.member.as_ref(),
            &id_bytes,
            &bump,
        ];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.grant.to_account_info(),
            permissioned_account: ctx.accounts.grant.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members: vec![],
            },
        }
        .invoke_signed(&[&seeds])?;
        Ok(())
    }

    pub fn activate_root_grant_privacy(ctx: Context<ActivateRootGrantPrivacy>) -> Result<()> {
        require!(
            ctx.accounts.policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            !ctx.accounts.grant.private_ready,
            MercuryError::PrivacyAlreadyActive
        );
        require_keys_eq!(
            ctx.accounts.grant.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        require_keys_eq!(
            ctx.accounts.grant.grantor,
            ctx.accounts.policy.founder,
            MercuryError::Unauthorized
        );
        let id_bytes = ctx.accounts.grant.id.to_le_bytes();
        let bump = [ctx.bumps.grant];
        let seeds: &[&[u8]] = &[
            GRANT_SEED,
            ctx.accounts.grant.company.as_ref(),
            ctx.accounts.grant.grantor.as_ref(),
            ctx.accounts.grant.member.as_ref(),
            &id_bytes,
            &bump,
        ];
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.grant.to_account_info(),
            permissioned_account: ctx.accounts.grant.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.grant.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![
                    Member {
                        flags,
                        pubkey: ctx.accounts.policy.founder,
                    },
                    Member {
                        flags,
                        pubkey: ctx.accounts.grant.member,
                    },
                ],
            },
        }
        .invoke_signed(&[&seeds])?;
        ctx.accounts.grant.private_ready = true;
        let policy_bump = [ctx.bumps.policy];
        let policy_seeds: &[&[u8]] = &[
            POLICY_SEED,
            ctx.accounts.policy.founder.as_ref(),
            &policy_bump,
        ];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.policy.to_account_info(),
            permissioned_account: ctx.accounts.policy.to_account_info(),
            permission: ctx.accounts.policy_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.policy.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![
                    Member {
                        flags,
                        pubkey: ctx.accounts.policy.founder,
                    },
                    Member {
                        flags,
                        pubkey: ctx.accounts.policy.finance,
                    },
                ],
            },
        }
        .invoke_signed(&[&policy_seeds])?;
        Ok(())
    }

    /// Founder issues a private, non-spending role for a requester or viewer.
    pub fn activate_member_grant_privacy(ctx: Context<ActivateRootGrantPrivacy>) -> Result<()> {
        require!(
            ctx.accounts.policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            !ctx.accounts.grant.private_ready,
            MercuryError::PrivacyAlreadyActive
        );
        require_keys_eq!(
            ctx.accounts.grant.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        require_keys_eq!(
            ctx.accounts.grant.grantor,
            ctx.accounts.policy.founder,
            MercuryError::Unauthorized
        );
        require!(
            ctx.accounts.grant.member != ctx.accounts.policy.founder
                && ctx.accounts.grant.member != ctx.accounts.policy.finance
                && ctx.accounts.grant.member != Pubkey::default(),
            MercuryError::InvalidMember
        );
        let id_bytes = ctx.accounts.grant.id.to_le_bytes();
        let bump = [ctx.bumps.grant];
        let seeds: &[&[u8]] = &[
            GRANT_SEED,
            ctx.accounts.grant.company.as_ref(),
            ctx.accounts.grant.grantor.as_ref(),
            ctx.accounts.grant.member.as_ref(),
            &id_bytes,
            &bump,
        ];
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.grant.to_account_info(),
            permissioned_account: ctx.accounts.grant.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.grant.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![
                    Member {
                        flags,
                        pubkey: ctx.accounts.policy.founder,
                    },
                    Member {
                        flags,
                        pubkey: ctx.accounts.grant.member,
                    },
                ],
            },
        }
        .invoke_signed(&[&seeds])?;
        ctx.accounts.grant.private_ready = true;
        Ok(())
    }

    /// Founder repairs or refreshes the company policy ACL from one active
    /// Finance grant after grant rotation. It cannot revive a revoked grant.
    pub fn restore_policy_readers(ctx: Context<ActivateRootGrantPrivacy>) -> Result<()> {
        let grant = &ctx.accounts.grant;
        require!(
            ctx.accounts.policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            grant.company == ctx.accounts.policy.key()
                && grant.grantor == ctx.accounts.policy.founder
                && grant.member == ctx.accounts.policy.finance
                && grant.parent == Pubkey::default()
                && grant.role == ROLE_FINANCE
                && grant.private_ready
                && grant.active
                && !grant.revoked,
            MercuryError::InvalidGrant
        );
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        let mut members = vec![
            Member {
                flags,
                pubkey: ctx.accounts.policy.founder,
            },
            Member {
                flags,
                pubkey: ctx.accounts.policy.finance,
            },
        ];
        for reader in &grant.child_readers {
            require!(
                !members.iter().any(|member| member.pubkey == *reader),
                MercuryError::DuplicateMember
            );
            members.push(Member {
                flags,
                pubkey: *reader,
            });
        }
        let bump = [ctx.bumps.policy];
        let seeds: &[&[u8]] = &[POLICY_SEED, ctx.accounts.policy.founder.as_ref(), &bump];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.policy.to_account_info(),
            permissioned_account: ctx.accounts.policy.to_account_info(),
            permission: ctx.accounts.policy_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.policy.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members,
            },
        }
        .invoke_signed(&[&seeds])?;
        Ok(())
    }

    /// Finance grants a manager access only after the manager is added to the
    /// parent grant's PER readers. This lets the manager verify parent revocation.
    pub fn activate_child_grant_privacy(ctx: Context<ActivateChildGrantPrivacy>) -> Result<()> {
        require!(
            ctx.accounts.policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            !ctx.accounts.grant.private_ready,
            MercuryError::PrivacyAlreadyActive
        );
        require_keys_eq!(
            ctx.accounts.grant.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        require_keys_eq!(
            ctx.accounts.parent.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        require_keys_eq!(
            ctx.accounts.parent.member,
            ctx.accounts.grantor.key(),
            MercuryError::Unauthorized
        );
        require!(
            ctx.accounts.parent.private_ready
                && ctx.accounts.parent.active
                && ctx.accounts.parent.may_delegate,
            MercuryError::Unauthorized
        );
        require!(
            ctx.accounts.parent.role == ROLE_FINANCE,
            MercuryError::Unauthorized
        );
        require!(
            ctx.accounts.grant.member != ctx.accounts.policy.founder
                && ctx.accounts.grant.member != ctx.accounts.policy.finance
                && ctx.accounts.grant.member != ctx.accounts.grantor.key(),
            MercuryError::InvalidMember
        );
        require!(
            ctx.accounts.parent.child_readers.len() < MAX_GRANT_READERS,
            MercuryError::TooManyMembers
        );
        require!(
            !ctx.accounts
                .parent
                .child_readers
                .contains(&ctx.accounts.grant.member),
            MercuryError::DuplicateMember
        );

        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        let mut parent_members = vec![
            Member {
                flags,
                pubkey: ctx.accounts.policy.founder,
            },
            Member {
                flags,
                pubkey: ctx.accounts.parent.member,
            },
        ];
        for reader in &ctx.accounts.parent.child_readers {
            parent_members.push(Member {
                flags,
                pubkey: *reader,
            });
        }
        parent_members.push(Member {
            flags,
            pubkey: ctx.accounts.grant.member,
        });
        let parent_id_bytes = ctx.accounts.parent.id.to_le_bytes();
        let parent_bump = [ctx.bumps.parent];
        let parent_seeds: &[&[u8]] = &[
            GRANT_SEED,
            ctx.accounts.parent.company.as_ref(),
            ctx.accounts.parent.grantor.as_ref(),
            ctx.accounts.parent.member.as_ref(),
            &parent_id_bytes,
            &parent_bump,
        ];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.parent.to_account_info(),
            permissioned_account: ctx.accounts.parent.to_account_info(),
            permission: ctx.accounts.parent_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.parent.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members: parent_members,
            },
        }
        .invoke_signed(&[&parent_seeds])?;

        let mut policy_members = vec![
            Member {
                flags,
                pubkey: ctx.accounts.policy.founder,
            },
            Member {
                flags,
                pubkey: ctx.accounts.policy.finance,
            },
        ];
        for reader in &ctx.accounts.parent.child_readers {
            policy_members.push(Member {
                flags,
                pubkey: *reader,
            });
        }
        policy_members.push(Member {
            flags,
            pubkey: ctx.accounts.grant.member,
        });
        let policy_bump = [ctx.bumps.policy];
        let policy_seeds: &[&[u8]] = &[
            POLICY_SEED,
            ctx.accounts.policy.founder.as_ref(),
            &policy_bump,
        ];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.policy.to_account_info(),
            permissioned_account: ctx.accounts.policy.to_account_info(),
            permission: ctx.accounts.policy_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.policy.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members: policy_members,
            },
        }
        .invoke_signed(&[&policy_seeds])?;

        let id_bytes = ctx.accounts.grant.id.to_le_bytes();
        let bump = [ctx.bumps.grant];
        let seeds: &[&[u8]] = &[
            GRANT_SEED,
            ctx.accounts.grant.company.as_ref(),
            ctx.accounts.grant.grantor.as_ref(),
            ctx.accounts.grant.member.as_ref(),
            &id_bytes,
            &bump,
        ];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.grant.to_account_info(),
            permissioned_account: ctx.accounts.grant.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.grant.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![
                    Member {
                        flags,
                        pubkey: ctx.accounts.policy.founder,
                    },
                    Member {
                        flags,
                        pubkey: ctx.accounts.grantor.key(),
                    },
                    Member {
                        flags,
                        pubkey: ctx.accounts.grant.member,
                    },
                ],
            },
        }
        .invoke_signed(&[&seeds])?;
        ctx.accounts.grant.parent = ctx.accounts.parent.key();
        ctx.accounts.grant.private_ready = true;
        ctx.accounts
            .parent
            .child_readers
            .push(ctx.accounts.grant.member);
        Ok(())
    }

    pub fn configure_grant(
        ctx: Context<ConfigureGrant>,
        role: u8,
        scope: Pubkey,
        per_payment_cap_micro: u64,
        period_cap_micro: u64,
        recipients: Vec<Pubkey>,
        may_delegate: bool,
    ) -> Result<()> {
        require!(
            ctx.accounts.grant.private_ready
                && !ctx.accounts.grant.active
                && !ctx.accounts.grant.revoked,
            MercuryError::WrongStatus
        );
        let non_spending = role == ROLE_REQUESTER || role == ROLE_VIEWER;
        if non_spending {
            require!(recipients.is_empty(), MercuryError::InvalidRecipient);
            require!(
                per_payment_cap_micro == 0 && period_cap_micro == 0 && !may_delegate,
                MercuryError::InvalidLimit
            );
        } else {
            require!(
                recipients.len() > 0 && recipients.len() <= MAX_GRANT_RECIPIENTS,
                MercuryError::InvalidRecipient
            );
            require!(
                per_payment_cap_micro > 0 && period_cap_micro >= per_payment_cap_micro,
                MercuryError::InvalidLimit
            );
        }
        for (index, recipient) in recipients.iter().enumerate() {
            require!(
                *recipient != Pubkey::default() && !recipients[..index].contains(recipient),
                MercuryError::InvalidRecipient
            );
        }
        if ctx.accounts.grantor.key() == ctx.accounts.policy.founder {
            require!(
                ctx.accounts.grant.parent == Pubkey::default(),
                MercuryError::InvalidGrant
            );
            if non_spending {
                require!(
                    ctx.accounts.grant.member != ctx.accounts.policy.founder
                        && ctx.accounts.grant.member != ctx.accounts.policy.finance,
                    MercuryError::InvalidMember
                );
            } else {
                require!(role == ROLE_FINANCE, MercuryError::Unauthorized);
                require_keys_eq!(
                    ctx.accounts.grant.member,
                    ctx.accounts.policy.finance,
                    MercuryError::Unauthorized
                );
                require!(scope == Pubkey::default(), MercuryError::InvalidScope);
                require!(
                    period_cap_micro <= ctx.accounts.policy.monthly_limit_micro,
                    MercuryError::InvalidLimit
                );
            }
        } else {
            let parent = ctx
                .accounts
                .parent
                .as_ref()
                .ok_or(MercuryError::MissingGrant)?;
            require_keys_eq!(
                parent.key(),
                ctx.accounts.grant.parent,
                MercuryError::InvalidGrant
            );
            require_keys_eq!(
                parent.member,
                ctx.accounts.grantor.key(),
                MercuryError::Unauthorized
            );
            require!(
                parent.active && parent.may_delegate && parent.role == ROLE_FINANCE,
                MercuryError::Unauthorized
            );
            require!(
                role == ROLE_MANAGER && !may_delegate,
                MercuryError::Unauthorized
            );
            require!(
                scope != Pubkey::default()
                    && (parent.scope == Pubkey::default() || scope == parent.scope),
                MercuryError::InvalidScope
            );
            require!(
                per_payment_cap_micro <= parent.per_payment_cap_micro
                    && period_cap_micro <= parent.period_cap_micro,
                MercuryError::InvalidLimit
            );
            for recipient in &recipients {
                require!(
                    parent.recipients.contains(recipient),
                    MercuryError::InvalidRecipient
                );
            }
        }
        let grant = &mut ctx.accounts.grant;
        grant.role = role;
        grant.scope = scope;
        grant.per_payment_cap_micro = per_payment_cap_micro;
        grant.period_cap_micro = period_cap_micro;
        grant.recipients = recipients;
        grant.may_delegate = may_delegate;
        grant.active = true;
        Ok(())
    }

    pub fn revoke_grant(ctx: Context<RevokeGrant>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.policy.founder
                || ctx.accounts.authority.key() == ctx.accounts.grant.grantor,
            MercuryError::Unauthorized
        );
        require!(ctx.accounts.grant.active, MercuryError::WrongStatus);
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        let mut policy_members = vec![Member {
            flags,
            pubkey: ctx.accounts.policy.founder,
        }];
        if ctx.accounts.grant.parent != Pubkey::default() {
            let parent = ctx
                .accounts
                .parent
                .as_mut()
                .ok_or(MercuryError::MissingGrant)?;
            let parent_permission = ctx
                .accounts
                .parent_permission
                .as_ref()
                .ok_or(MercuryError::MissingGrant)?;
            require_keys_eq!(
                parent.key(),
                ctx.accounts.grant.parent,
                MercuryError::InvalidGrant
            );
            require_keys_eq!(
                parent.company,
                ctx.accounts.policy.key(),
                MercuryError::WrongCompany
            );
            require_keys_eq!(
                parent.member,
                ctx.accounts.grant.grantor,
                MercuryError::Unauthorized
            );
            require!(
                parent.child_readers.contains(&ctx.accounts.grant.member),
                MercuryError::InvalidGrant
            );
            parent
                .child_readers
                .retain(|reader| *reader != ctx.accounts.grant.member);
            let mut parent_members = vec![
                Member {
                    flags,
                    pubkey: ctx.accounts.policy.founder,
                },
                Member {
                    flags,
                    pubkey: parent.member,
                },
            ];
            for reader in &parent.child_readers {
                parent_members.push(Member {
                    flags,
                    pubkey: *reader,
                });
            }
            let parent_id_bytes = parent.id.to_le_bytes();
            let parent_bump = [ctx.bumps.parent.ok_or(MercuryError::MissingGrant)?];
            let expected_parent_permission = Pubkey::find_program_address(
                &[PERMISSION_SEED, parent.key().as_ref()],
                &PERMISSION_PROGRAM_ID,
            )
            .0;
            require_keys_eq!(
                parent_permission.key(),
                expected_parent_permission,
                MercuryError::InvalidGrant
            );
            let parent_seeds: &[&[u8]] = &[
                GRANT_SEED,
                parent.company.as_ref(),
                parent.grantor.as_ref(),
                parent.member.as_ref(),
                &parent_id_bytes,
                &parent_bump,
            ];
            UpdateEphemeralPermissionCpi {
                payer: parent.to_account_info(),
                permissioned_account: parent.to_account_info(),
                permission: parent_permission.to_account_info(),
                vault: ctx.accounts.ephemeral_vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                authority: parent.to_account_info(),
                authority_is_signer: false,
                args: EphemeralMembersArgs {
                    is_private: true,
                    members: parent_members,
                },
            }
            .invoke_signed(&[&parent_seeds])?;
            policy_members.push(Member {
                flags,
                pubkey: ctx.accounts.policy.finance,
            });
            for reader in &parent.child_readers {
                policy_members.push(Member {
                    flags,
                    pubkey: *reader,
                });
            }
        }
        let id_bytes = ctx.accounts.grant.id.to_le_bytes();
        let bump = [ctx.bumps.grant];
        let seeds: &[&[u8]] = &[
            GRANT_SEED,
            ctx.accounts.grant.company.as_ref(),
            ctx.accounts.grant.grantor.as_ref(),
            ctx.accounts.grant.member.as_ref(),
            &id_bytes,
            &bump,
        ];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.grant.to_account_info(),
            permissioned_account: ctx.accounts.grant.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.grant.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![Member {
                    flags,
                    pubkey: ctx.accounts.policy.founder,
                }],
            },
        }
        .invoke_signed(&[&seeds])?;
        let policy_bump = [ctx.bumps.policy];
        let policy_seeds: &[&[u8]] = &[
            POLICY_SEED,
            ctx.accounts.policy.founder.as_ref(),
            &policy_bump,
        ];
        if ctx.accounts.grant.role == ROLE_FINANCE || ctx.accounts.grant.parent != Pubkey::default()
        {
            UpdateEphemeralPermissionCpi {
                payer: ctx.accounts.policy.to_account_info(),
                permissioned_account: ctx.accounts.policy.to_account_info(),
                permission: ctx.accounts.policy_permission.to_account_info(),
                vault: ctx.accounts.ephemeral_vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                authority: ctx.accounts.policy.to_account_info(),
                authority_is_signer: false,
                args: EphemeralMembersArgs {
                    is_private: true,
                    members: policy_members,
                },
            }
            .invoke_signed(&[&policy_seeds])?;
        }
        ctx.accounts.grant.active = false;
        ctx.accounts.grant.revoked = true;
        Ok(())
    }

    /// Public shell. It carries no balance before private access is active.
    pub fn create_snapshot_shell(ctx: Context<CreateSnapshotShell>, company: Pubkey) -> Result<()> {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.founder.to_account_info(),
                    to: ctx.accounts.snapshot.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(2) as u32),
        )?;
        let snapshot = &mut ctx.accounts.snapshot;
        snapshot.company = company;
        snapshot.founder = ctx.accounts.founder.key();
        snapshot.finance = Pubkey::default();
        snapshot.mint = Pubkey::default();
        snapshot.private_ready = false;
        snapshot.balance_micro = 0;
        snapshot.updated_slot = 0;
        Ok(())
    }

    pub fn delegate_snapshot(ctx: Context<DelegateSnapshot>, company: Pubkey) -> Result<()> {
        ctx.accounts.delegate_snapshot(
            &ctx.accounts.founder,
            &[SNAPSHOT_SEED, company.as_ref()],
            DelegateConfig {
                validator: Some(ctx.accounts.validator.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn init_snapshot_permission(ctx: Context<SnapshotPermissionContext>) -> Result<()> {
        let bump = [ctx.bumps.snapshot];
        let seeds: &[&[u8]] = &[SNAPSHOT_SEED, ctx.accounts.snapshot.company.as_ref(), &bump];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.snapshot.to_account_info(),
            permissioned_account: ctx.accounts.snapshot.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members: vec![],
            },
        }
        .invoke_signed(&[&seeds])?;
        Ok(())
    }

    pub fn activate_snapshot_privacy(
        ctx: Context<ActivateSnapshotPrivacy>,
        include_finance: bool,
    ) -> Result<()> {
        require!(
            ctx.accounts.policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            !ctx.accounts.snapshot.private_ready,
            MercuryError::PrivacyAlreadyActive
        );
        require_keys_eq!(
            ctx.accounts.snapshot.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        let bump = [ctx.bumps.snapshot];
        let seeds: &[&[u8]] = &[SNAPSHOT_SEED, ctx.accounts.snapshot.company.as_ref(), &bump];
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        let mut members = vec![Member {
            flags,
            pubkey: ctx.accounts.policy.founder,
        }];
        if include_finance && ctx.accounts.policy.finance != ctx.accounts.policy.founder {
            members.push(Member {
                flags,
                pubkey: ctx.accounts.policy.finance,
            });
        }
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.snapshot.to_account_info(),
            permissioned_account: ctx.accounts.snapshot.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.snapshot.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members,
            },
        }
        .invoke_signed(&[&seeds])?;
        let snapshot = &mut ctx.accounts.snapshot;
        snapshot.finance = ctx.accounts.policy.finance;
        snapshot.mint = ctx.accounts.policy.mint;
        snapshot.private_ready = true;
        Ok(())
    }

    /// Founder refreshes snapshot visibility after a Finance grant is revoked.
    pub fn set_snapshot_readers(
        ctx: Context<ActivateSnapshotPrivacy>,
        include_finance: bool,
    ) -> Result<()> {
        require!(
            ctx.accounts.snapshot.private_ready,
            MercuryError::PrivacyNotActive
        );
        require_keys_eq!(
            ctx.accounts.snapshot.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        let mut members = vec![Member {
            flags,
            pubkey: ctx.accounts.policy.founder,
        }];
        if include_finance && ctx.accounts.policy.finance != ctx.accounts.policy.founder {
            members.push(Member {
                flags,
                pubkey: ctx.accounts.policy.finance,
            });
        }
        let bump = [ctx.bumps.snapshot];
        let seeds: &[&[u8]] = &[SNAPSHOT_SEED, ctx.accounts.snapshot.company.as_ref(), &bump];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.snapshot.to_account_info(),
            permissioned_account: ctx.accounts.snapshot.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.snapshot.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members,
            },
        }
        .invoke_signed(&[&seeds])?;
        Ok(())
    }

    /// Finance copies the canonical company ATA amount into a PER-private view.
    /// The slot lets clients distinguish a fresh observation from stale state.
    pub fn sync_treasury_snapshot(ctx: Context<SyncTreasurySnapshot>) -> Result<()> {
        if ctx.accounts.actor.key() != ctx.accounts.policy.founder {
            let grant = ctx
                .accounts
                .grant
                .as_ref()
                .ok_or(MercuryError::MissingGrant)?;
            require_keys_eq!(
                ctx.accounts.actor.key(),
                ctx.accounts.policy.finance,
                MercuryError::Unauthorized
            );
            require_keys_eq!(
                grant.company,
                ctx.accounts.policy.key(),
                MercuryError::WrongCompany
            );
            require_keys_eq!(
                grant.member,
                ctx.accounts.actor.key(),
                MercuryError::Unauthorized
            );
            require_keys_eq!(
                grant.grantor,
                ctx.accounts.policy.founder,
                MercuryError::Unauthorized
            );
            require!(
                grant.active && !grant.revoked && grant.private_ready && grant.role == ROLE_FINANCE,
                MercuryError::Unauthorized
            );
        }
        require!(
            ctx.accounts.policy.private_ready && ctx.accounts.snapshot.private_ready,
            MercuryError::PrivacyNotActive
        );
        require_keys_eq!(
            ctx.accounts.snapshot.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        require_keys_eq!(
            ctx.accounts.treasury_token.owner,
            ctx.accounts.policy.key(),
            MercuryError::WrongTokenOwner
        );
        require_keys_eq!(
            ctx.accounts.treasury_token.mint,
            ctx.accounts.policy.mint,
            MercuryError::InvalidMint
        );
        let policy_key = ctx.accounts.policy.key();
        let token_program_key = Token::id();
        let expected_ata = Pubkey::find_program_address(
            &[
                policy_key.as_ref(),
                token_program_key.as_ref(),
                ctx.accounts.policy.mint.as_ref(),
            ],
            &anchor_spl::associated_token::ID,
        )
        .0;
        require_keys_eq!(
            ctx.accounts.treasury_token.key(),
            expected_ata,
            MercuryError::WrongTokenAccount
        );
        ctx.accounts.snapshot.balance_micro = ctx.accounts.treasury_token.amount;
        ctx.accounts.snapshot.updated_slot = Clock::get()?.slot;
        Ok(())
    }

    /// Public shell with no recipient or amount. The requester pays its rent.
    pub fn create_request_shell(
        ctx: Context<CreateRequestShell>,
        company: Pubkey,
        id: u64,
    ) -> Result<()> {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.requester.to_account_info(),
                    to: ctx.accounts.request.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(5) as u32),
        )?;
        let request = &mut ctx.accounts.request;
        request.company = company;
        request.requester = ctx.accounts.requester.key();
        request.id = id;
        request.private_ready = false;
        request.recipient = Pubkey::default();
        request.amount_micro = 0;
        request.status = STATUS_EMPTY;
        request.approved_period = 0;
        Ok(())
    }

    /// Base-layer delegation. The caller must be the requester PDA seed.
    pub fn delegate_request(ctx: Context<DelegateRequest>, company: Pubkey, id: u64) -> Result<()> {
        let requester = ctx.accounts.requester.key();
        let id_bytes = id.to_le_bytes();
        ctx.accounts.delegate_request(
            &ctx.accounts.requester,
            &[
                REQUEST_SEED,
                company.as_ref(),
                requester.as_ref(),
                &id_bytes,
            ],
            DelegateConfig {
                validator: Some(ctx.accounts.validator.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// ER-local permission. Call before adding a private recipient or amount.
    pub fn init_request_permission(ctx: Context<RequestPermissionContext>) -> Result<()> {
        let id_bytes = ctx.accounts.request.id.to_le_bytes();
        let bump = [ctx.bumps.request];
        let seeds: &[&[u8]] = &[
            REQUEST_SEED,
            ctx.accounts.request.company.as_ref(),
            ctx.accounts.request.requester.as_ref(),
            &id_bytes,
            &bump,
        ];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.request.to_account_info(),
            permissioned_account: ctx.accounts.request.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members: vec![],
            },
        }
        .invoke_signed(&[&seeds])?;
        Ok(())
    }

    /// Founder onboards this requester to this company. The privacy CPI and
    /// readiness flag are atomic; later private data writes require the flag.
    pub fn activate_request_privacy(
        ctx: Context<ActivateRequestPrivacy>,
        include_finance: bool,
        manager: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            !ctx.accounts.request.private_ready,
            MercuryError::PrivacyAlreadyActive
        );
        require_keys_eq!(
            ctx.accounts.request.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        if ctx.accounts.request.requester != ctx.accounts.policy.founder {
            let grant = ctx
                .accounts
                .requester_grant
                .as_ref()
                .ok_or(MercuryError::MissingGrant)?;
            let finance_requester = ctx.accounts.request.requester == ctx.accounts.policy.finance;
            require!(
                grant.company == ctx.accounts.policy.key()
                    && grant.grantor == ctx.accounts.policy.founder
                    && grant.member == ctx.accounts.request.requester
                    && grant.role
                        == if finance_requester {
                            ROLE_FINANCE
                        } else {
                            ROLE_REQUESTER
                        }
                    && grant.private_ready
                    && grant.active
                    && !grant.revoked
                    && (finance_requester
                        || grant.scope == Pubkey::default()
                        || grant.scope
                            == request_branch_scope(
                                ctx.accounts.policy.key(),
                                ctx.accounts.request.id
                            )?),
                MercuryError::Unauthorized
            );
        }
        let id_bytes = ctx.accounts.request.id.to_le_bytes();
        let bump = [ctx.bumps.request];
        let seeds: &[&[u8]] = &[
            REQUEST_SEED,
            ctx.accounts.request.company.as_ref(),
            ctx.accounts.request.requester.as_ref(),
            &id_bytes,
            &bump,
        ];
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        let mut members = vec![Member {
            flags,
            pubkey: ctx.accounts.policy.founder,
        }];
        if ctx.accounts.request.requester != ctx.accounts.policy.founder {
            members.push(Member {
                flags,
                pubkey: ctx.accounts.request.requester,
            });
        }
        if include_finance
            && ctx.accounts.policy.finance != ctx.accounts.policy.founder
            && ctx.accounts.policy.finance != ctx.accounts.request.requester
        {
            members.push(Member {
                flags,
                pubkey: ctx.accounts.policy.finance,
            });
        }
        if manager != Pubkey::default() {
            require!(
                !members.iter().any(|member| member.pubkey == manager),
                MercuryError::DuplicateMember
            );
            members.push(Member {
                flags,
                pubkey: manager,
            });
        }
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.request.to_account_info(),
            permissioned_account: ctx.accounts.request.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.request.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members,
            },
        }
        .invoke_signed(&[&seeds])?;
        ctx.accounts.request.private_ready = true;
        Ok(())
    }

    /// Founder updates a request's private readers when a delegated role is
    /// revoked. The backend must apply this to every indexed affected request.
    pub fn set_request_readers(
        ctx: Context<ActivateRequestPrivacy>,
        include_finance: bool,
        manager: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.request.private_ready,
            MercuryError::PrivacyNotActive
        );
        require_keys_eq!(
            ctx.accounts.request.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        let mut members = vec![Member {
            flags,
            pubkey: ctx.accounts.policy.founder,
        }];
        if ctx.accounts.request.requester != ctx.accounts.policy.founder {
            members.push(Member {
                flags,
                pubkey: ctx.accounts.request.requester,
            });
        }
        if include_finance
            && ctx.accounts.policy.finance != ctx.accounts.policy.founder
            && ctx.accounts.policy.finance != ctx.accounts.request.requester
        {
            members.push(Member {
                flags,
                pubkey: ctx.accounts.policy.finance,
            });
        }
        if manager != Pubkey::default() {
            require!(
                !members.iter().any(|member| member.pubkey == manager),
                MercuryError::DuplicateMember
            );
            members.push(Member {
                flags,
                pubkey: manager,
            });
        }
        let id_bytes = ctx.accounts.request.id.to_le_bytes();
        let bump = [ctx.bumps.request];
        let seeds: &[&[u8]] = &[
            REQUEST_SEED,
            ctx.accounts.request.company.as_ref(),
            ctx.accounts.request.requester.as_ref(),
            &id_bytes,
            &bump,
        ];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.request.to_account_info(),
            permissioned_account: ctx.accounts.request.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.request.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members,
            },
        }
        .invoke_signed(&[&seeds])?;
        Ok(())
    }

    /// Founder can grant a Viewer access or remove a departed requester's read
    /// access while keeping payment authority unchanged.
    pub fn set_request_readers_v2(
        ctx: Context<SetRequestReadersV2>,
        include_requester: bool,
        include_finance: bool,
        manager: Pubkey,
        viewer: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.request.private_ready,
            MercuryError::PrivacyNotActive
        );
        require_keys_eq!(
            ctx.accounts.request.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        if viewer != Pubkey::default() {
            let grant = ctx
                .accounts
                .viewer_grant
                .as_ref()
                .ok_or(MercuryError::MissingGrant)?;
            require!(
                grant.company == ctx.accounts.policy.key()
                    && grant.grantor == ctx.accounts.policy.founder
                    && grant.member == viewer
                    && grant.role == ROLE_VIEWER
                    && grant.private_ready
                    && grant.active
                    && !grant.revoked
                    && (grant.scope == Pubkey::default()
                        || grant.scope
                            == request_branch_scope(
                                ctx.accounts.policy.key(),
                                ctx.accounts.request.id
                            )?),
                MercuryError::Unauthorized
            );
        }
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        let mut members = vec![Member {
            flags,
            pubkey: ctx.accounts.policy.founder,
        }];
        let mut add = |address: Pubkey| -> Result<()> {
            require!(
                !members.iter().any(|member| member.pubkey == address),
                MercuryError::DuplicateMember
            );
            members.push(Member {
                flags,
                pubkey: address,
            });
            Ok(())
        };
        if include_requester && ctx.accounts.request.requester != ctx.accounts.policy.founder {
            add(ctx.accounts.request.requester)?;
        }
        if include_finance && ctx.accounts.policy.finance != ctx.accounts.policy.founder {
            add(ctx.accounts.policy.finance)?;
        }
        if manager != Pubkey::default() {
            add(manager)?;
        }
        if viewer != Pubkey::default() {
            add(viewer)?;
        }
        require!(members.len() <= 5, MercuryError::TooManyMembers);
        let id_bytes = ctx.accounts.request.id.to_le_bytes();
        let bump = [ctx.bumps.request];
        let seeds: &[&[u8]] = &[
            REQUEST_SEED,
            ctx.accounts.request.company.as_ref(),
            ctx.accounts.request.requester.as_ref(),
            &id_bytes,
            &bump,
        ];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.request.to_account_info(),
            permissioned_account: ctx.accounts.request.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.request.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members,
            },
        }
        .invoke_signed(&[&seeds])?;
        Ok(())
    }

    /// Only the requester can populate the private amount and recipient.
    pub fn submit_payment(
        ctx: Context<SubmitPayment>,
        recipient: Pubkey,
        amount_micro: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.request.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        if ctx.accounts.request.requester != ctx.accounts.policy.founder {
            let grant = ctx
                .accounts
                .requester_grant
                .as_ref()
                .ok_or(MercuryError::MissingGrant)?;
            let finance_requester = ctx.accounts.request.requester == ctx.accounts.policy.finance;
            require!(
                grant.company == ctx.accounts.policy.key()
                    && grant.grantor == ctx.accounts.policy.founder
                    && grant.member == ctx.accounts.request.requester
                    && grant.role
                        == if finance_requester {
                            ROLE_FINANCE
                        } else {
                            ROLE_REQUESTER
                        }
                    && grant.private_ready
                    && grant.active
                    && !grant.revoked
                    && (finance_requester
                        || grant.scope == Pubkey::default()
                        || grant.scope
                            == request_branch_scope(
                                ctx.accounts.policy.key(),
                                ctx.accounts.request.id
                            )?),
                MercuryError::Unauthorized
            );
        }
        require!(
            ctx.accounts.request.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            ctx.accounts.request.status == STATUS_EMPTY,
            MercuryError::WrongStatus
        );
        require!(
            recipient != Pubkey::default(),
            MercuryError::InvalidRecipient
        );
        require!(amount_micro > 0, MercuryError::InvalidAmount);
        let request = &mut ctx.accounts.request;
        request.recipient = recipient;
        request.amount_micro = amount_micro;
        request.status = STATUS_SUBMITTED;
        Ok(())
    }

    /// Reserve this request against the current thirty-day budget.
    pub fn approve_payment(ctx: Context<ApprovePayment>) -> Result<()> {
        let actor = ctx.accounts.actor.key();
        let founder = ctx.accounts.policy.founder;
        let amount = ctx.accounts.request.amount_micro;
        if actor != founder {
            let grant = ctx
                .accounts
                .grant
                .as_mut()
                .ok_or(MercuryError::MissingGrant)?;
            require_keys_eq!(
                grant.company,
                ctx.accounts.policy.key(),
                MercuryError::WrongCompany
            );
            require_keys_eq!(grant.member, actor, MercuryError::Unauthorized);
            require!(
                grant.private_ready && grant.active,
                MercuryError::Unauthorized
            );
            require!(
                grant.role == ROLE_FINANCE || grant.role == ROLE_MANAGER,
                MercuryError::Unauthorized
            );
            grant.check_payment(ctx.accounts.request.recipient, amount)?;
            if grant.role == ROLE_FINANCE {
                require_keys_eq!(grant.grantor, founder, MercuryError::Unauthorized);
                require_keys_eq!(
                    actor,
                    ctx.accounts.policy.finance,
                    MercuryError::Unauthorized
                );
                require!(
                    grant.parent == Pubkey::default(),
                    MercuryError::InvalidGrant
                );
            } else {
                require_keys_eq!(
                    grant.scope,
                    request_branch_scope(ctx.accounts.policy.key(), ctx.accounts.request.id)?,
                    MercuryError::InvalidScope
                );
                let parent = ctx
                    .accounts
                    .parent_grant
                    .as_ref()
                    .ok_or(MercuryError::MissingGrant)?;
                require_keys_eq!(parent.key(), grant.parent, MercuryError::InvalidGrant);
                require_keys_eq!(
                    parent.company,
                    ctx.accounts.policy.key(),
                    MercuryError::WrongCompany
                );
                require_keys_eq!(parent.member, grant.grantor, MercuryError::Unauthorized);
                require!(
                    parent.active && parent.role == ROLE_FINANCE && parent.may_delegate,
                    MercuryError::Unauthorized
                );
                require_keys_eq!(
                    parent.member,
                    ctx.accounts.policy.finance,
                    MercuryError::Unauthorized
                );
                let period = Clock::get()?.unix_timestamp.div_euclid(PERIOD_SECONDS);
                if grant.period != period {
                    grant.period = period;
                    grant.spent_micro = 0;
                    grant.approved_micro = 0;
                }
                let next = grant
                    .approved_micro
                    .checked_add(amount)
                    .ok_or(MercuryError::Overflow)?;
                require!(next <= grant.period_cap_micro, MercuryError::BudgetExceeded);
                grant.approved_micro = next;
            }
        }
        require!(
            ctx.accounts.policy.private_ready && ctx.accounts.request.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            ctx.accounts.request.status == STATUS_SUBMITTED,
            MercuryError::WrongStatus
        );
        let period = Clock::get()?.unix_timestamp.div_euclid(PERIOD_SECONDS);
        let policy = &mut ctx.accounts.policy;
        if policy.period != period {
            policy.period = period;
            policy.spent_micro = 0;
            policy.reserved_micro = 0;
        }
        let total = policy
            .spent_micro
            .checked_add(policy.reserved_micro)
            .and_then(|x| x.checked_add(ctx.accounts.request.amount_micro))
            .ok_or(MercuryError::Overflow)?;
        require!(
            total <= policy.monthly_limit_micro,
            MercuryError::BudgetExceeded
        );
        policy.reserved_micro = policy
            .reserved_micro
            .checked_add(ctx.accounts.request.amount_micro)
            .ok_or(MercuryError::Overflow)?;
        ctx.accounts.request.approved_period = period;
        ctx.accounts.request.status = STATUS_APPROVED;
        Ok(())
    }

    /// One PER transaction enforces approval and budget, transfers USDC via
    /// PDA-signed SPL CPI, and finalizes the request. CPI failure reverts state.
    pub fn execute_payment(ctx: Context<ExecutePayment>) -> Result<()> {
        let actor = ctx.accounts.actor.key();
        let founder = ctx.accounts.policy.founder;
        let amount = ctx.accounts.request.amount_micro;
        if actor != founder {
            let grant = ctx
                .accounts
                .grant
                .as_mut()
                .ok_or(MercuryError::MissingGrant)?;
            require_keys_eq!(
                grant.company,
                ctx.accounts.policy.key(),
                MercuryError::WrongCompany
            );
            require_keys_eq!(grant.member, actor, MercuryError::Unauthorized);
            require_keys_eq!(
                actor,
                ctx.accounts.policy.finance,
                MercuryError::Unauthorized
            );
            require_keys_eq!(grant.grantor, founder, MercuryError::Unauthorized);
            require!(
                grant.private_ready
                    && grant.active
                    && grant.role == ROLE_FINANCE
                    && grant.parent == Pubkey::default(),
                MercuryError::Unauthorized
            );
            grant.check_payment(ctx.accounts.request.recipient, amount)?;
            let period = Clock::get()?.unix_timestamp.div_euclid(PERIOD_SECONDS);
            if grant.period != period {
                grant.period = period;
                grant.spent_micro = 0;
                grant.approved_micro = 0;
            }
            let next = grant
                .spent_micro
                .checked_add(amount)
                .ok_or(MercuryError::Overflow)?;
            require!(next <= grant.period_cap_micro, MercuryError::BudgetExceeded);
            grant.spent_micro = next;
        }
        require!(
            ctx.accounts.policy.private_ready && ctx.accounts.request.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            ctx.accounts.request.status == STATUS_APPROVED,
            MercuryError::WrongStatus
        );
        let period = Clock::get()?.unix_timestamp.div_euclid(PERIOD_SECONDS);
        require!(
            ctx.accounts.request.approved_period == period && ctx.accounts.policy.period == period,
            MercuryError::ApprovalExpired
        );
        let amount = ctx.accounts.request.amount_micro;
        require!(
            ctx.accounts.policy.reserved_micro >= amount,
            MercuryError::BudgetExceeded
        );
        require_keys_eq!(
            ctx.accounts.treasury_token.owner,
            ctx.accounts.policy.key(),
            MercuryError::WrongTokenOwner
        );
        require_keys_eq!(
            ctx.accounts.treasury_token.mint,
            ctx.accounts.policy.mint,
            MercuryError::InvalidMint
        );
        require_keys_eq!(
            ctx.accounts.recipient_token.owner,
            ctx.accounts.request.recipient,
            MercuryError::InvalidRecipient
        );
        require_keys_eq!(
            ctx.accounts.recipient_token.mint,
            ctx.accounts.policy.mint,
            MercuryError::InvalidMint
        );
        let bump = [ctx.bumps.policy];
        let seeds: &[&[u8]] = &[POLICY_SEED, ctx.accounts.policy.founder.as_ref(), &bump];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.treasury_token.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: ctx.accounts.policy.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        ctx.accounts.policy.reserved_micro -= amount;
        ctx.accounts.policy.spent_micro = ctx
            .accounts
            .policy
            .spent_micro
            .checked_add(amount)
            .ok_or(MercuryError::Overflow)?;
        ctx.accounts.request.status = STATUS_EXECUTED;
        Ok(())
    }

    /// Finance can reject a request and release its current-period reserve.
    pub fn reject_payment(ctx: Context<ApprovePayment>) -> Result<()> {
        let actor = ctx.accounts.actor.key();
        if actor != ctx.accounts.policy.founder {
            let grant = ctx
                .accounts
                .grant
                .as_ref()
                .ok_or(MercuryError::MissingGrant)?;
            require_keys_eq!(
                grant.company,
                ctx.accounts.policy.key(),
                MercuryError::WrongCompany
            );
            require_keys_eq!(grant.member, actor, MercuryError::Unauthorized);
            require!(
                grant.active
                    && grant.private_ready
                    && (grant.role == ROLE_FINANCE || grant.role == ROLE_MANAGER),
                MercuryError::Unauthorized
            );
            require!(!grant.revoked, MercuryError::Unauthorized);
            grant.check_payment(
                ctx.accounts.request.recipient,
                ctx.accounts.request.amount_micro,
            )?;
            if grant.role == ROLE_MANAGER {
                require_keys_eq!(
                    grant.scope,
                    request_branch_scope(ctx.accounts.policy.key(), ctx.accounts.request.id)?,
                    MercuryError::InvalidScope
                );
                let parent = ctx
                    .accounts
                    .parent_grant
                    .as_ref()
                    .ok_or(MercuryError::MissingGrant)?;
                require_keys_eq!(parent.key(), grant.parent, MercuryError::InvalidGrant);
                require!(
                    parent.active
                        && !parent.revoked
                        && parent.private_ready
                        && parent.role == ROLE_FINANCE
                        && parent.may_delegate
                        && parent.member == grant.grantor
                        && parent.grantor == ctx.accounts.policy.founder
                        && parent.member == ctx.accounts.policy.finance,
                    MercuryError::Unauthorized
                );
            } else {
                require!(
                    grant.grantor == ctx.accounts.policy.founder
                        && grant.member == ctx.accounts.policy.finance
                        && grant.parent == Pubkey::default(),
                    MercuryError::Unauthorized
                );
            }
        }
        let status = ctx.accounts.request.status;
        require!(
            status == STATUS_SUBMITTED || status == STATUS_APPROVED,
            MercuryError::WrongStatus
        );
        if status == STATUS_APPROVED
            && ctx.accounts.request.approved_period == ctx.accounts.policy.period
        {
            ctx.accounts.policy.reserved_micro = ctx
                .accounts
                .policy
                .reserved_micro
                .checked_sub(ctx.accounts.request.amount_micro)
                .ok_or(MercuryError::Overflow)?;
        }
        ctx.accounts.request.status = STATUS_REJECTED;
        Ok(())
    }

    /// Base shell: no spending amount or destination is published here.
    pub fn create_agent_shell(
        ctx: Context<CreateAgentShell>,
        company: Pubkey,
        agent: Pubkey,
    ) -> Result<()> {
        require!(agent != Pubkey::default(), MercuryError::InvalidAgent);
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.founder.to_account_info(),
                    to: ctx.accounts.agent_policy.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(3) as u32),
        )?;
        let policy = &mut ctx.accounts.agent_policy;
        policy.company = company;
        policy.founder = ctx.accounts.founder.key();
        policy.finance = Pubkey::default();
        policy.agent = agent;
        policy.mint = Pubkey::default();
        policy.private_ready = false;
        policy.revoked = false;
        policy.allowed_recipient = Pubkey::default();
        policy.per_payment_cap_micro = 0;
        policy.period_cap_micro = 0;
        policy.period = 0;
        policy.spent_micro = 0;
        Ok(())
    }

    pub fn delegate_agent(
        ctx: Context<DelegateAgent>,
        company: Pubkey,
        agent: Pubkey,
    ) -> Result<()> {
        let founder = ctx.accounts.founder.key();
        ctx.accounts.delegate_agent_policy(
            &ctx.accounts.founder,
            &[
                AGENT_SEED,
                founder.as_ref(),
                company.as_ref(),
                agent.as_ref(),
            ],
            DelegateConfig {
                validator: Some(ctx.accounts.validator.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn init_agent_permission(ctx: Context<AgentPermissionContext>) -> Result<()> {
        let bump = [ctx.bumps.agent_policy];
        let seeds: &[&[u8]] = &[
            AGENT_SEED,
            ctx.accounts.agent_policy.founder.as_ref(),
            ctx.accounts.agent_policy.company.as_ref(),
            ctx.accounts.agent_policy.agent.as_ref(),
            &bump,
        ];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.agent_policy.to_account_info(),
            permissioned_account: ctx.accounts.agent_policy.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members: vec![],
            },
        }
        .invoke_signed(&[&seeds])?;
        Ok(())
    }

    pub fn activate_agent_privacy(ctx: Context<ActivateAgentPrivacy>) -> Result<()> {
        require!(
            ctx.accounts.policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            !ctx.accounts.agent_policy.private_ready,
            MercuryError::PrivacyAlreadyActive
        );
        require_keys_eq!(
            ctx.accounts.agent_policy.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        let bump = [ctx.bumps.agent_policy];
        let seeds: &[&[u8]] = &[
            AGENT_SEED,
            ctx.accounts.agent_policy.founder.as_ref(),
            ctx.accounts.agent_policy.company.as_ref(),
            ctx.accounts.agent_policy.agent.as_ref(),
            &bump,
        ];
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.agent_policy.to_account_info(),
            permissioned_account: ctx.accounts.agent_policy.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.agent_policy.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![
                    Member {
                        flags,
                        pubkey: ctx.accounts.policy.founder,
                    },
                    Member {
                        flags,
                        pubkey: ctx.accounts.policy.finance,
                    },
                    Member {
                        flags,
                        pubkey: ctx.accounts.agent_policy.agent,
                    },
                ],
            },
        }
        .invoke_signed(&[&seeds])?;
        let agent_policy = &mut ctx.accounts.agent_policy;
        agent_policy.finance = ctx.accounts.policy.finance;
        agent_policy.mint = ctx.accounts.policy.mint;
        agent_policy.private_ready = true;
        Ok(())
    }

    /// Founder chooses one allowed recipient and two hard caps for this agent.
    pub fn configure_agent(
        ctx: Context<ConfigureAgent>,
        recipient: Pubkey,
        per_payment_cap_micro: u64,
        period_cap_micro: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.agent_policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            !ctx.accounts.agent_policy.revoked,
            MercuryError::AgentRevoked
        );
        require!(
            recipient != Pubkey::default(),
            MercuryError::InvalidRecipient
        );
        require!(
            per_payment_cap_micro > 0 && period_cap_micro >= per_payment_cap_micro,
            MercuryError::InvalidLimit
        );
        let agent_policy = &mut ctx.accounts.agent_policy;
        agent_policy.allowed_recipient = recipient;
        agent_policy.per_payment_cap_micro = per_payment_cap_micro;
        agent_policy.period_cap_micro = period_cap_micro;
        Ok(())
    }

    /// Until agent delegation is implemented, only Founder allocates Agent float.
    pub fn fund_agent_float(ctx: Context<FundAgentFloat>, amount_micro: u64) -> Result<()> {
        require!(
            ctx.accounts.policy.private_ready && ctx.accounts.agent_policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            !ctx.accounts.agent_policy.revoked,
            MercuryError::AgentRevoked
        );
        require!(amount_micro > 0, MercuryError::InvalidAmount);
        let period = Clock::get()?.unix_timestamp.div_euclid(PERIOD_SECONDS);
        let agent_spent = if ctx.accounts.agent_policy.period == period {
            ctx.accounts.agent_policy.spent_micro
        } else {
            0
        };
        let agent_total = agent_spent
            .checked_add(ctx.accounts.agent_float_token.amount)
            .and_then(|x| x.checked_add(amount_micro))
            .ok_or(MercuryError::Overflow)?;
        require!(
            agent_total <= ctx.accounts.agent_policy.period_cap_micro
                && agent_total <= ctx.accounts.policy.agent_cap_micro,
            MercuryError::BudgetExceeded
        );
        if ctx.accounts.policy.period != period {
            ctx.accounts.policy.period = period;
            ctx.accounts.policy.spent_micro = 0;
            ctx.accounts.policy.reserved_micro = 0;
        }
        let company_total = ctx
            .accounts
            .policy
            .spent_micro
            .checked_add(ctx.accounts.policy.reserved_micro)
            .and_then(|x| x.checked_add(amount_micro))
            .ok_or(MercuryError::Overflow)?;
        require!(
            company_total <= ctx.accounts.policy.monthly_limit_micro,
            MercuryError::BudgetExceeded
        );
        require_keys_eq!(
            ctx.accounts.treasury_token.owner,
            ctx.accounts.policy.key(),
            MercuryError::WrongTokenOwner
        );
        require_keys_eq!(
            ctx.accounts.treasury_token.mint,
            ctx.accounts.policy.mint,
            MercuryError::InvalidMint
        );
        require_keys_eq!(
            ctx.accounts.agent_float_token.owner,
            ctx.accounts.agent_policy.key(),
            MercuryError::WrongTokenOwner
        );
        require_keys_eq!(
            ctx.accounts.agent_float_token.mint,
            ctx.accounts.policy.mint,
            MercuryError::InvalidMint
        );
        let bump = [ctx.bumps.policy];
        let seeds: &[&[u8]] = &[POLICY_SEED, ctx.accounts.policy.founder.as_ref(), &bump];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.treasury_token.to_account_info(),
                    to: ctx.accounts.agent_float_token.to_account_info(),
                    authority: ctx.accounts.policy.to_account_info(),
                },
                &[seeds],
            ),
            amount_micro,
        )?;
        ctx.accounts.policy.spent_micro = ctx
            .accounts
            .policy
            .spent_micro
            .checked_add(amount_micro)
            .ok_or(MercuryError::Overflow)?;
        ctx.accounts.agent_policy.period = period;
        ctx.accounts.agent_policy.spent_micro = agent_spent;
        Ok(())
    }

    /// Agent cannot touch the main treasury; only its separate token float.
    pub fn agent_pay(ctx: Context<AgentPay>, amount_micro: u64) -> Result<()> {
        require!(
            ctx.accounts.agent_policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            !ctx.accounts.agent_policy.revoked,
            MercuryError::AgentRevoked
        );
        require!(
            amount_micro > 0 && amount_micro <= ctx.accounts.agent_policy.per_payment_cap_micro,
            MercuryError::InvalidAmount
        );
        require_keys_eq!(
            ctx.accounts.agent_float_token.owner,
            ctx.accounts.agent_policy.key(),
            MercuryError::WrongTokenOwner
        );
        require_keys_eq!(
            ctx.accounts.agent_float_token.mint,
            ctx.accounts.agent_policy.mint,
            MercuryError::InvalidMint
        );
        require_keys_eq!(
            ctx.accounts.recipient_token.owner,
            ctx.accounts.agent_policy.allowed_recipient,
            MercuryError::InvalidRecipient
        );
        require_keys_eq!(
            ctx.accounts.recipient_token.mint,
            ctx.accounts.agent_policy.mint,
            MercuryError::InvalidMint
        );
        let period = Clock::get()?.unix_timestamp.div_euclid(PERIOD_SECONDS);
        let spent = if ctx.accounts.agent_policy.period == period {
            ctx.accounts.agent_policy.spent_micro
        } else {
            0
        };
        let next_spent = spent
            .checked_add(amount_micro)
            .ok_or(MercuryError::Overflow)?;
        require!(
            next_spent <= ctx.accounts.agent_policy.period_cap_micro,
            MercuryError::BudgetExceeded
        );
        let bump = [ctx.bumps.agent_policy];
        let seeds: &[&[u8]] = &[
            AGENT_SEED,
            ctx.accounts.agent_policy.founder.as_ref(),
            ctx.accounts.agent_policy.company.as_ref(),
            ctx.accounts.agent_policy.agent.as_ref(),
            &bump,
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.agent_float_token.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: ctx.accounts.agent_policy.to_account_info(),
                },
                &[seeds],
            ),
            amount_micro,
        )?;
        ctx.accounts.agent_policy.period = period;
        ctx.accounts.agent_policy.spent_micro = next_spent;
        Ok(())
    }

    pub fn revoke_agent(ctx: Context<ActivateAgentPrivacy>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.agent_policy.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        require!(
            ctx.accounts.agent_policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require!(
            !ctx.accounts.agent_policy.revoked,
            MercuryError::AgentRevoked
        );
        let bump = [ctx.bumps.agent_policy];
        let seeds: &[&[u8]] = &[
            AGENT_SEED,
            ctx.accounts.agent_policy.founder.as_ref(),
            ctx.accounts.agent_policy.company.as_ref(),
            ctx.accounts.agent_policy.agent.as_ref(),
            &bump,
        ];
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.agent_policy.to_account_info(),
            permissioned_account: ctx.accounts.agent_policy.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.agent_policy.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![
                    Member {
                        flags,
                        pubkey: ctx.accounts.policy.founder,
                    },
                    Member {
                        flags,
                        pubkey: ctx.accounts.policy.finance,
                    },
                ],
            },
        }
        .invoke_signed(&[&seeds])?;
        ctx.accounts.agent_policy.revoked = true;
        Ok(())
    }

    /// Founder reclaims unspent float after revocation or rotation.
    pub fn reclaim_agent_float(ctx: Context<FundAgentFloat>, amount_micro: u64) -> Result<()> {
        require!(amount_micro > 0, MercuryError::InvalidAmount);
        require_keys_eq!(
            ctx.accounts.treasury_token.owner,
            ctx.accounts.policy.key(),
            MercuryError::WrongTokenOwner
        );
        require_keys_eq!(
            ctx.accounts.treasury_token.mint,
            ctx.accounts.policy.mint,
            MercuryError::InvalidMint
        );
        require_keys_eq!(
            ctx.accounts.agent_float_token.owner,
            ctx.accounts.agent_policy.key(),
            MercuryError::WrongTokenOwner
        );
        require_keys_eq!(
            ctx.accounts.agent_float_token.mint,
            ctx.accounts.policy.mint,
            MercuryError::InvalidMint
        );
        let bump = [ctx.bumps.agent_policy];
        let seeds: &[&[u8]] = &[
            AGENT_SEED,
            ctx.accounts.agent_policy.founder.as_ref(),
            ctx.accounts.agent_policy.company.as_ref(),
            ctx.accounts.agent_policy.agent.as_ref(),
            &bump,
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.agent_float_token.to_account_info(),
                    to: ctx.accounts.treasury_token.to_account_info(),
                    authority: ctx.accounts.agent_policy.to_account_info(),
                },
                &[seeds],
            ),
            amount_micro,
        )?;
        Ok(())
    }
}

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

    fn check_payment(&self, recipient: Pubkey, amount: u64) -> Result<()> {
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

#[cfg(test)]
mod team_grant_tests {
    use super::*;

    #[test]
    fn payment_grant_requires_active_status_recipient_and_cap() {
        let allowed = Pubkey::new_unique();
        let denied = Pubkey::new_unique();
        let mut grant = TeamGrant {
            company: Pubkey::new_unique(),
            grantor: Pubkey::new_unique(),
            member: Pubkey::new_unique(),
            id: 0,
            parent: Pubkey::default(),
            scope: Pubkey::default(),
            role: ROLE_FINANCE,
            private_ready: true,
            active: true,
            revoked: false,
            may_delegate: false,
            per_payment_cap_micro: 100,
            period_cap_micro: 500,
            period: 0,
            spent_micro: 0,
            approved_micro: 0,
            recipients: vec![allowed],
            child_readers: Vec::new(),
        };
        assert!(grant.check_payment(allowed, 100).is_ok());
        assert!(grant.check_payment(allowed, 101).is_err());
        assert!(grant.check_payment(denied, 1).is_err());
        grant.active = false;
        assert!(grant.check_payment(allowed, 1).is_err());
        grant.active = true;
        grant.revoked = true;
        assert!(grant.check_payment(allowed, 1).is_err());
    }

    #[test]
    fn manager_scope_is_derived_from_the_request_branch() {
        let company = Pubkey::new_unique();
        let branch: u64 = 42;
        let request_id = (branch << 40) | 123;
        let expected = Pubkey::find_program_address(
            &[BRANCH_SCOPE_SEED, company.as_ref(), &[42, 0, 0]],
            &crate::ID,
        )
        .0;
        assert_eq!(request_branch_scope(company, request_id).unwrap(), expected);
        assert!(request_branch_scope(company, 123).is_err());
    }
}
