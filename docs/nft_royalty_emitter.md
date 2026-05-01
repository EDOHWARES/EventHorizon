# NFT Royalties Settlement logic with Emitter events

## Overview
A settlement engine for distributing royalties from secondary NFT sales to multiple recipients.

## Objective
To provide a transparent and automated way to handle royalty payouts, ensuring creators and stakeholders receive their fair share from marketplace transactions.

## Features
- **Multi-recipient Splits**: Supports distributing royalties across an array of addresses with configurable percentages.
- **BPS Precision**: Uses Basis Points (1/10,000) for high-precision percentage calculations.
- **Transparency Events**: Emits detailed events for every payout, making it easy to index and audit on-chain.
- **Collection Configuration**: Admin-controlled settings for different NFT collections.

## Implementation Details
- **Registry**: Maps collection addresses to a list of `RoyaltyRecipient` objects.
- **Function**: `settle(collection, amount, payment_token, payer)`
    - Iterates through recipients.
    - Calculates `(amount * BPS) / 10000`.
    - Transfers tokens and emits `roy_pay` event.

## Best Practices
- Marketplaces should call `settle` during the trade execution to ensure atomic royalty distribution.
- BPS values for a collection must not exceed 10,000 in total.
