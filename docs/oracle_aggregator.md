# Multi-sig Oracle Aggregator with Consensus Logic

## Overview
A decentralized oracle price aggregator that consolidates feeds from multiple sources into a single reliable price using consensus logic.

## Objective
To mitigate the risk of price manipulation or single-source failure by requiring multiple independent reports before a price is considered "valid".

## Features
- **Median-of-N Consensus**: Uses the median of multiple reports to eliminate outliers.
- **Quorum Requirement**: Only emits a consensus price once a minimum threshold of reports is reached.
- **Staleness Protection**: Reports older than a configured `MaxAge` are ignored.
- **Authorized Oracles**: Only whitelisted oracle addresses can submit reports.

## Implementation Details
- **Algorithm**: When a new report is received, the contract filters all current reports for staleness, sorts the valid ones, and finds the median.
- **Threshold**: Configurable `min_reports` required for consensus.
- **Events**:
    - `rep_sub`: Emitted for every valid report.
    - `consensus`: Emitted only when the quorum is reached and a median is calculated.

## Performance
- Optimized for small to medium-sized oracle sets (N < 20).
- Uses efficient on-chain sorting and filtering logic.
