# MagicBlock PER proof catalog

Generated from Mercurii's persisted devnet testing receipts on 2026-10-12T20:17:03.969Z.

- MagicBlock private endpoint: `https://devnet-tee.magicblock.app`
- Unique PER receipts discovered: **218**
- Currently finalized on the TEE validator: **218**
- The accompanying JSON contains every receipt, operation, signature, TEE slot/finality, source artifact, and custom Explorer URL.

## Complete private payment flow

This is one complete company flow. Base-layer steps create and delegate public shells; the PER/TEE steps create private permissions, write the private request, approve it, and update the private treasury snapshot.

| Network | Operation | TEE slot | Explorer |
| --- | --- | ---: | --- |
| Base devnet | privateReceive | — | [proof](https://explorer.solana.com/tx/4buRhdSDesBWr4Y9J8bYoX2Ryzgwd9AWDqPaqHkzELJNaFEFFhHTcC7oFaWV1vDXgXTAMaiipVhQXGx3B5TMvfDo?cluster=devnet) |
| PER / TEE | syncTreasurySnapshot | 489970534 | [proof](https://explorer.solana.com/tx/3cjSrqSUVvoXUtEjvcXiHLDRwMg9FWHuVbZ3nDQGUTAvML6W1yYV1S3iF7ZXx8GfF6jn6r53Gohke1Y7FvUA2dEs?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| Base devnet | paymentFlow:82288342-7a10-4f7c-a515-cf4c62a444ac:createRequestShell | — | [proof](https://explorer.solana.com/tx/2qD47V692yWJfwPi3vJZsr6vBmoite55m4zkbjDHSEjsum6npZCtCyqDivZtPFVKrotoSe2xgipk5PA7ir5DDFYr?cluster=devnet) |
| Base devnet | paymentFlow:82288342-7a10-4f7c-a515-cf4c62a444ac:delegateRequest | — | [proof](https://explorer.solana.com/tx/TnnrvjxM9CgLZCjTUSGriGEsL97EAKSe96UnqZpdhzGS8hYZ2A82FF4JCGYiX4xW4YJFGZQ3PC1JzihcYKAAoPN?cluster=devnet) |
| PER / TEE | paymentFlow:82288342-7a10-4f7c-a515-cf4c62a444ac:initRequestPermission | 489972652 | [proof](https://explorer.solana.com/tx/bDkZEJgxbQgx7PRb5mgcBteZPKY6r8ZgCBFsEM5B9DrvVhS9Eh2wKWj4iPcwgBnJRXXwVNFs3D7pkVgkw5z8w6Z?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| PER / TEE | paymentFlow:82288342-7a10-4f7c-a515-cf4c62a444ac:activateRequestPrivacy | 489972798 | [proof](https://explorer.solana.com/tx/62Sv7iqZDYNENwHLEJr51CYPHrqBne1i7xw35go77ryY2BsAByaKRynU7MQsFAbKrGAgaSZZnsSrwqZ8WVj5TmbG?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| PER / TEE | paymentFlow:82288342-7a10-4f7c-a515-cf4c62a444ac:submitPayment | 489972950 | [proof](https://explorer.solana.com/tx/ZtuE8o9wuwZzZFU1U5vpetoa9GhZkSfcuxTy5wu7tEmL7mw25HC3ejHcj8VLXGZVmRtf4ECyKf4noFNNnpGQn9y?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| PER / TEE | paymentFlow:82288342-7a10-4f7c-a515-cf4c62a444ac:approvePayment | 489973132 | [proof](https://explorer.solana.com/tx/5FG99DybKnmRMrXGqW7Mbwz4mVBQFkwEPWMbd7YTpiP5TXJf5UvNcCnMAMLgMsKtjk84XyuPQbw3cinSMGSxFLwV?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |
| PER / TEE | paymentSnapshotSync | 489973606 | [proof](https://explorer.solana.com/tx/c5U2Dk9CkNcjk7ehxKxf1TbWA96jeBuQNCSmEpxycPUaNtc9ZViprpSXp4YGqmFqGjdJA1Gmty7RhAJ9tABESeX?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app) |

## How to use a PER proof

Every `PER / TEE` link points Solana Explorer at MagicBlock's private devnet validator through `cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee.magicblock.app`. It verifies the transaction against the PER endpoint. Private account contents remain permissioned and are not placed in the URL.

## Machine-readable records

See [magicblock-per-proof-catalog.json](./magicblock-per-proof-catalog.json).
