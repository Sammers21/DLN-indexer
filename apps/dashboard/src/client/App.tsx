import { useState, useEffect, useCallback } from "react";
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

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
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
  // Fetch date range on mount to set defaults
  useEffect(() => {
    fetch("/api/default_range")
      .then((res) => res.json())
      .then((data: { from: string; to: string }) => {
        if (data.from && data.to) {
          setStartDate(toDateInput(data.from));
          setEndDate(toDateInput(data.to));
        }
        setRangeLoaded(true);
      })
      .catch(() => setRangeLoaded(true));
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
      <header>
        <h1>DLN Volume Dashboard</h1>
        <div className="filters">
          <div className="filter-group">
            <label>
              From:
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                }}
              />
            </label>
            <label>
              To:
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
      </header>
      {error && <div className="error">{error}</div>}
      <div className="charts-grid">
        <div className="charts-section">
          <h2>Created Orders Volume (USD)</h2>
          <div className="chart-container">
            {loading ? (
              <div className="loading">Loading chart data...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={createdVolumes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => formatUsd(value)}
                  />
                  <Tooltip
                    formatter={(value: number) => formatUsd(value)}
                    labelStyle={{ fontWeight: "bold" }}
                  />
                  <Bar dataKey="volume_usd" fill="#4f46e5" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="charts-section">
          <h2>Fulfilled Orders Volume (USD)</h2>
          <div className="chart-container">
            {loading ? (
              <div className="loading">Loading chart data...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fulfilledVolumes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => formatUsd(value)}
                  />
                  <Tooltip
                    formatter={(value: number) => formatUsd(value)}
                    labelStyle={{ fontWeight: "bold" }}
                  />
                  <Bar dataKey="volume_usd" fill="#10b981" />
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
