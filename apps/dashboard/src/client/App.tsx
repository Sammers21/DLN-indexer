import { useState, useEffect, useCallback, useMemo } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

interface VolumeRow {
  period: string;
  order_count: number;
  volume_usd: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: VolumeRow }>;
  label?: string;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const data = payload[0].payload;
  return (
    <div
      style={{
        background: "rgba(15, 23, 42, 0.92)",
        border: "1px solid rgba(148, 163, 184, 0.25)",
        borderRadius: 12,
        padding: "10px 14px",
        color: "#e2e8f0",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ marginBottom: 4 }}>
        Volume: {formatUsd(data.volume_usd)}
      </div>
      <div>Orders: {data.order_count.toLocaleString()}</div>
    </div>
  );
}

function sumVolumeUsd(rows: VolumeRow[]): number {
  return rows.reduce((sum, row) => sum + row.volume_usd, 0);
}

function sumOrderCount(rows: VolumeRow[]): number {
  return rows.reduce((sum, row) => sum + row.order_count, 0);
}

function maxVolumeUsd(rows: VolumeRow[]): number {
  return rows.reduce(
    (max, row) => (row.volume_usd > max ? row.volume_usd : max),
    0,
  );
}

function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  const niceFraction =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

function toDateInput(isoString: string): string {
  return isoString.slice(0, 10);
}

function App() {
  const [createdVolumes, setCreatedVolumes] = useState<VolumeRow[]>([]);
  const [fulfilledVolumes, setFulfilledVolumes] = useState<VolumeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rangeLoaded, setRangeLoaded] = useState(false);
  const createdTotalUsd = useMemo(
    () => sumVolumeUsd(createdVolumes),
    [createdVolumes],
  );
  const fulfilledTotalUsd = useMemo(
    () => sumVolumeUsd(fulfilledVolumes),
    [fulfilledVolumes],
  );
  const createdOrderCount = useMemo(
    () => sumOrderCount(createdVolumes),
    [createdVolumes],
  );
  const fulfilledOrderCount = useMemo(
    () => sumOrderCount(fulfilledVolumes),
    [fulfilledVolumes],
  );
  const yDomain = useMemo((): [number, number | "auto"] => {
    const max = Math.max(
      maxVolumeUsd(createdVolumes),
      maxVolumeUsd(fulfilledVolumes),
    );
    if (max <= 0) return [0, "auto"];
    return [0, niceCeil(max * 1.05)];
  }, [createdVolumes, fulfilledVolumes]);
  // Fetch date range on mount to set defaults
  useEffect(() => {
    fetch("/api/default_range")
      .then((res) => {
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        return res.json();
      })
      .then((data: { from: string; to: string }) => {
        if (data.from && data.to) {
          setStartDate(toDateInput(data.from));
          setEndDate(toDateInput(data.to));
        }
        setRangeLoaded(true);
      })
      .catch((err) => {
        setError(`Failed to connect to API: ${err.message}`);
        setRangeLoaded(true);
      });
  }, []);
  const fetchData = useCallback(async () => {
    if (!rangeLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("from", startDate);
      if (endDate) params.set("to", endDate);
      const queryString = params.toString() ? `?${params.toString()}` : "";
      const [createdRes, fulfilledRes] = await Promise.all([
        fetch(`/api/volume/createOrder${queryString}`),
        fetch(`/api/volume/fulfilled${queryString}`),
      ]);
      if (!createdRes.ok || !fulfilledRes.ok) {
        throw new Error("Failed to fetch volume data");
      }
      const [createdData, fulfilledData] = await Promise.all([
        createdRes.json(),
        fulfilledRes.json(),
      ]);
      setCreatedVolumes(createdData);
      setFulfilledVolumes(fulfilledData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, rangeLoaded]);
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  return (
    <div className="container">
      <div className="page-header">
        <div className="title-block">
          <h1>DLN Volume Dashboard</h1>
          <div className="subtitle">Created (left) vs Fulfilled (right)</div>
        </div>
        <div className="filters">
          <div className="filter-group">
            <label>
              From
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                }}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                }}
              />
            </label>
          </div>
        </div>
      </div>
      {error && <div className="banner banner--error">{error}</div>}
      <div className="charts-grid">
        <div className="chart-card">
          <div className="card-header">
            <div className="card-title">
              <span className="indicator indicator--created" />
              <h2>Created Order Volume</h2>
            </div>
            <div className="card-metrics">
              <div className="card-metric">{formatUsd(createdTotalUsd)}</div>
              <div className="card-metric card-metric--count">
                {createdOrderCount.toLocaleString()} orders
              </div>
            </div>
          </div>
          <div className="chart-container">
            {loading ? (
              <div className="loading">Loading chart data...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={createdVolumes}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="createdGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#6366f1"
                        stopOpacity={0.95}
                      />
                      <stop
                        offset="100%"
                        stopColor="#4338ca"
                        stopOpacity={0.65}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(148, 163, 184, 0.35)"
                  />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 12, fill: "#475569" }}
                  />
                  <YAxis
                    domain={yDomain}
                    tick={{ fontSize: 12, fill: "#475569" }}
                    tickFormatter={(value) => formatUsd(value)}
                    tickCount={6}
                    width={72}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar
                    dataKey="volume_usd"
                    fill="url(#createdGradient)"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="chart-card">
          <div className="card-header">
            <div className="card-title">
              <span className="indicator indicator--fulfilled" />
              <h2>Fulfilled Order Volume</h2>
            </div>
            <div className="card-metrics">
              <div className="card-metric">{formatUsd(fulfilledTotalUsd)}</div>
              <div className="card-metric card-metric--count">
                {fulfilledOrderCount.toLocaleString()} orders
              </div>
            </div>
          </div>
          <div className="chart-container">
            {loading ? (
              <div className="loading">Loading chart data...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={fulfilledVolumes}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="fulfilledGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.9} />
                      <stop
                        offset="100%"
                        stopColor="#059669"
                        stopOpacity={0.6}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(148, 163, 184, 0.35)"
                  />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 12, fill: "#475569" }}
                  />
                  <YAxis
                    domain={yDomain}
                    tick={{ fontSize: 12, fill: "#475569" }}
                    tickFormatter={(value) => formatUsd(value)}
                    tickCount={6}
                    width={72}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar
                    dataKey="volume_usd"
                    fill="url(#fulfilledGradient)"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
