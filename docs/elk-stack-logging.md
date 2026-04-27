# ELK Stack Logging Pipeline

This document describes the backend ELK logging pipeline configuration for EventHorizon. It covers structured log generation, Logstash ingestion, Kibana dashboard import, and log rotation/archival behavior.

## 1. Backend Log Configuration

The backend now uses `winston` with daily rotated JSON logs. Logs are written to:

- `backend/logs/eventhorizon-%DATE%.log`
- `backend/logs/eventhorizon-error-%DATE%.log`

Key behavior:

- Logs are written as structured JSON objects.
- Daily rotation is enabled.
- Old logs are compressed automatically using `zippedArchive`.
- Retention is controlled by `LOG_RETENTION_DAYS`.

### Environment variables

- `LOG_DIR`: directory for log output (default `backend/logs`)
- `LOG_LEVEL`: default log level (default `debug` in non-production, `info` in production)
- `LOG_RETENTION_DAYS`: number of days to retain rotated log files (default `30d`)

## 2. Logstash Pipeline Configuration

A sample Logstash pipeline is provided in `backend/logstash/eventhorizon_pipeline.conf`.

### Example input

Logstash reads backend logs with a JSON codec:

```conf
input {
  file {
    path => "/var/log/eventhorizon/eventhorizon-*.log"
    start_position => "beginning"
    sincedb_path => "/var/lib/logstash/eventhorizon.sincedb"
    codec => json
    discover_interval => 15
    ignore_older => 86400
  }
}
```

### Example output

Events are sent to Elasticsearch as `eventhorizon-backend-%{+YYYY.MM.dd}`.

## 3. Kibana Dashboard

A Kibana dashboard definition is available at `backend/kibana/eventhorizon-logs-dashboard.ndjson`.

This includes:

- `EventHorizon Log Level Distribution`
- `Recent Error Events`
- A dashboard titled `EventHorizon Backend Logs`

Import the NDJSON file through Kibana Management > Saved Objects.

## 4. Log Rotation and Archival

Application logs rotate daily and are compressed automatically.

To enable storage rotation and archival:

1. Set `LOG_RETENTION_DAYS` to the desired retention window.
2. Route `LOG_DIR` to a persistent host volume or centralized log directory.
3. Use the provided Logstash pipeline to ingest rotated logs into Elasticsearch.

## 5. Verification

1. Install backend dependencies: `npm install --workspace=backend`
2. Start the backend: `npm run dev --workspace=backend`
3. Confirm log files appear in `backend/logs/`.
4. Import `backend/logstash/eventhorizon_pipeline.conf` into Logstash as the pipeline configuration.
5. Import `backend/kibana/eventhorizon-logs-dashboard.ndjson` into Kibana.

## 6. Notes

- Logstash ingest is configured for JSON logs so the pipeline can safely parse structured backend events.
- The backend log pipeline does not require changes to application behavior beyond using the new `winston` logger.
- For production, route `LOG_DIR` to `/var/log/eventhorizon` or another centralized location, and keep the same JSON-compatible file naming.
