# External Data Oracle (Weather / Logistics)

The `ExternalDataOracle` contract provides a simple on-chain oracle registry for **non-financial real-world data** (e.g., weather readings and logistics/shipping events) with **multi-source validation**.

## Goals

- **Registry for non-financial data points** via named feeds (`Symbol` feed IDs).
- **Standardized logistics event format** for event-driven triggers.
- **Multi-source validation** so a single source cannot unilaterally set a value.

## Roles

- **Admin**: manages authorized oracle sources and registers feeds.
- **Source**: submits observations to feeds (must be authorized).

## Key Types

- `FeedConfig`
  - `Numeric { min_sources, max_age, tolerance_bps }`
  - `Logistics { min_sources, max_age }`
- `ValidatedFeed { value, validated_at, sources_used }`
- `ValidatedValue`
  - `Numeric(i128)`
  - `Logistics(LogisticsEvent)`
- `LogisticsEvent { shipment_id, event_type, status, location, eta }`

## Core Methods

### Initialization / Admin

- `initialize(admin: Address)`
- `admin() -> Address`
- `add_source(admin: Address, source: Address)`
- `remove_source(admin: Address, source: Address)`
- `sources() -> Vec<Address>`
- `is_source(source: Address) -> bool`

### Feed Registration

- `register_numeric_feed(admin, feed_id, min_sources, max_age, tolerance_bps)`
  - Validation uses the **median** across fresh submissions.
  - If `tolerance_bps` is set, *all* included values must fall within the tolerance of the median.
- `register_logistics_feed(admin, feed_id, min_sources, max_age)`
  - Validation uses the **mode** (most common) `LogisticsEvent` across fresh submissions.

### Submissions / Validation

- `submit_numeric(source, feed_id, value, observed_at) -> Option<ValidatedFeed>`
- `submit_logistics(source, feed_id, event, observed_at) -> Option<ValidatedFeed>`
- `validate_feed(feed_id) -> Option<ValidatedFeed>`
- `get_validated(feed_id) -> Option<ValidatedFeed>`

## Validation Rules

- Submissions older than `max_age` seconds are ignored.
- Validation only succeeds once `min_sources` fresh submissions are present.
- Numeric feeds: median (+ optional tolerance check).
- Logistics feeds: majority/mode consensus.

## Typical Feed IDs

- Weather: `temp_c`, `rain_mm`, `humidity_bps`, `wind_mps`
- Logistics: `shipment_status`, `port_arrival`, `customs_clearance`

