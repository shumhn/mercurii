use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token::{self, Token, Transfer as SplTransfer};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::{CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi},
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, PERMISSION_SEED, TX_BALANCES_FLAG,
            TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::ephemeral,
    consts::PERMISSION_PROGRAM_ID,
    cpi::DelegateConfig,
};

declare_id!("34Ah4S3AWxXDU9GebANCqJC3qJ91ybZrZ6LDC5HJnX4L");

mod constants;
mod contexts;
mod errors;
mod helpers;
mod state;

use constants::*;
use contexts::*;
use errors::MercuryError;
use helpers::*;

#[cfg(test)]
use state::TeamGrant;

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

    /// Remove the Finance reader after its grant is revoked. A previously
    /// revoked Agent must not regain read access through this cleanup.
    pub fn remove_finance_agent_reader(ctx: Context<ActivateAgentPrivacy>) -> Result<()> {
        require!(
            ctx.accounts.agent_policy.private_ready,
            MercuryError::PrivacyNotActive
        );
        require_keys_eq!(
            ctx.accounts.agent_policy.company,
            ctx.accounts.policy.key(),
            MercuryError::WrongCompany
        );
        let policy = &ctx.accounts.agent_policy;
        let bump = [ctx.bumps.agent_policy];
        let seeds: &[&[u8]] = &[
            AGENT_SEED,
            policy.founder.as_ref(),
            policy.company.as_ref(),
            policy.agent.as_ref(),
            &bump,
        ];
        let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;
        let mut members = vec![Member {
            flags,
            pubkey: ctx.accounts.policy.founder,
        }];
        if !policy.revoked {
            members.push(Member {
                flags,
                pubkey: policy.agent,
            });
        }
        UpdateEphemeralPermissionCpi {
            payer: policy.to_account_info(),
            permissioned_account: policy.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: policy.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members,
            },
        }
        .invoke_signed(&[&seeds])?;
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
