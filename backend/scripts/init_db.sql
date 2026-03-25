-- Connect as superuser and create extensions in nifty50_timeseries database
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Table 1: Candle data
CREATE TABLE IF NOT EXISTS candles (
    timestamp TIMESTAMPTZ NOT NULL,
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    open NUMERIC NOT NULL,
    high NUMERIC NOT NULL,
    low NUMERIC NOT NULL,
    close NUMERIC NOT NULL,
    volume BIGINT DEFAULT 0,
    oi BIGINT DEFAULT 0,
    PRIMARY KEY (timestamp, symbol, interval)
);
SELECT create_hypertable('candles', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_candles_symbol_interval ON candles(symbol, interval, timestamp DESC);

-- Table 2: Technical indicator snapshots
CREATE TABLE IF NOT EXISTS indicator_snapshots (
    timestamp TIMESTAMPTZ NOT NULL,
    symbol TEXT NOT NULL,
    indicator_name TEXT NOT NULL,
    value NUMERIC,
    extra JSONB,
    PRIMARY KEY (timestamp, symbol, indicator_name)
);
SELECT create_hypertable('indicator_snapshots', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_indicators_name ON indicator_snapshots(indicator_name, timestamp DESC);

-- Table 3: Derived metric snapshots
CREATE TABLE IF NOT EXISTS derived_metric_snapshots (
    timestamp TIMESTAMPTZ NOT NULL,
    symbol TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    value NUMERIC,
    metadata JSONB,
    PRIMARY KEY (timestamp, symbol, metric_name)
);
SELECT create_hypertable('derived_metric_snapshots', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_derived_name ON derived_metric_snapshots(metric_name, timestamp DESC);

-- Table 4: GEX snapshots
CREATE TABLE IF NOT EXISTS gex_snapshots (
    timestamp TIMESTAMPTZ NOT NULL,
    expiry_date DATE NOT NULL,
    spot_price NUMERIC NOT NULL,
    total_gex NUMERIC,
    net_gex NUMERIC,
    zero_gamma_level NUMERIC,
    call_wall NUMERIC,
    put_wall NUMERIC,
    pcr NUMERIC,
    strike_gex JSONB,
    PRIMARY KEY (timestamp, expiry_date)
);
SELECT create_hypertable('gex_snapshots', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_gex_expiry ON gex_snapshots(expiry_date, timestamp DESC);

-- Table 5: Live price ticks
CREATE TABLE IF NOT EXISTS price_ticks (
    timestamp TIMESTAMPTZ NOT NULL,
    symbol TEXT NOT NULL,
    ltp NUMERIC NOT NULL,
    ltt TIMESTAMPTZ,
    volume BIGINT DEFAULT 0,
    oi BIGINT DEFAULT 0,
    cp NUMERIC
);
SELECT create_hypertable('price_ticks', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_ticks_symbol ON price_ticks(symbol, timestamp DESC);
