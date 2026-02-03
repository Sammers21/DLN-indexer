import { useState, useEffect, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

type VolumeInterval = "day" | "hour" | "15min";

interface VolumeRow {
  period: string;
  created_volume: number;
  fulfilled_volume: number;
  created_count: number;
  fulfilled_count: number;
}

interface Summary {
  total_created_volume_usd: number;
  total_fulfilled_volume_usd: number;
  total_created_count: number;
  total_fulfilled_count: number;
}

interface Order {
  order_id: string;
  event_type: "created" | "fulfilled";
  tx_signature: string;
  block_time: string;
  usd_value?: number;
}

const INTERVAL_LABELS: Record<VolumeInterval, string> = {
  day: "Daily",
  hour: "Hourly",
  "15min": "15-Minute",
};

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function toDateInput(isoString: string): string {
  return isoString.slice(0, 10);
}

function toDateTimeInput(isoString: string): string {
  // "2024-01-15 13:00:00" or "2024-01-15T13:00:00" → "2024-01-15T13:00"
  return isoString.replace(" ", "T").slice(0, 16);
}

function App() {
  const [volumes, setVolumes] = useState<VolumeRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [interval, setInterval] = useState<VolumeInterval>("day");
  const [rangeLoaded, setRangeLoaded] = useState(false);

  // Fetch date range on mount to set defaults
  useEffect(() => {
    fetch("/api/date-range")
      .then((res) => res.json())
      .then((data: { min: string; max: string }) => {
        if (data.min && data.max) {
          setStartDate(toDateInput(data.min));
          setEndDate(toDateInput(data.max));
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
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      params.set("interval", interval);
      const queryString = params.toString() ? `?${params.toString()}` : "";
      const [volumesRes, summaryRes, ordersRes] = await Promise.all([
        fetch(`/api/volumes/daily${queryString}`),
        fetch(`/api/volumes/summary${queryString}`),
        fetch(
          `/api/orders?page=${page}&limit=10${startDate ? `&start_date=${startDate}` : ""}${endDate ? `&end_date=${endDate}` : ""}`
        ),
      ]);
      if (!volumesRes.ok || !summaryRes.ok || !ordersRes.ok) {
        throw new Error("Failed to fetch data");
      }
      const [volumesData, summaryData, ordersData] = await Promise.all([
        volumesRes.json(),
        summaryRes.json(),
        ordersRes.json(),
      ]);
      setVolumes(volumesData);
      setSummary(summaryData);
      setOrders(ordersData.orders);
      setOrdersTotal(ordersData.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, interval, page, rangeLoaded]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = Math.ceil(ordersTotal / 10);
  const inputType = interval === "day" ? "date" : "datetime-local";
  const intervalLabel = INTERVAL_LABELS[interval];

  return (
    <div className="container">
      <header>
        <h1>DLN Order Analytics</h1>
        <div className="filters">
          <div className="filter-group">
            <label>
              Group by:
              <select
                value={interval}
                onChange={(e) => {
                  const newInterval = e.target.value as VolumeInterval;
                  setInterval(newInterval);
                  setPage(1);
                  // Convert date formats when switching intervals
                  if (newInterval === "day") {
                    setStartDate((v) => toDateInput(v));
                    setEndDate((v) => toDateInput(v));
                  } else {
                    setStartDate((v) => v.length === 10 ? `${v}T00:00` : v);
                    setEndDate((v) => v.length === 10 ? `${v}T23:59` : v);
                  }
                }}
              >
                <option value="day">Day</option>
                <option value="hour">Hour</option>
                <option value="15min">15 Minutes</option>
              </select>
            </label>
          </div>
          <div className="filter-group">
            <label>
              From:
              <input
                type={inputType}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              To:
              <input
                type={inputType}
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>
        </div>
      </header>
      {error && <div className="error">{error}</div>}
      <div className="stats-grid">
        <div className="stat-card created">
          <h3>Created Orders</h3>
          <div className="value">
            {summary ? formatNumber(summary.total_created_count) : "-"}
          </div>
        </div>
        <div className="stat-card fulfilled">
          <h3>Fulfilled Orders</h3>
          <div className="value">
            {summary ? formatNumber(summary.total_fulfilled_count) : "-"}
          </div>
        </div>
        <div className="stat-card created">
          <h3>Created Volume</h3>
          <div className="value">
            {summary ? formatUsd(summary.total_created_volume_usd) : "-"}
          </div>
        </div>
        <div className="stat-card fulfilled">
          <h3>Fulfilled Volume</h3>
          <div className="value">
            {summary ? formatUsd(summary.total_fulfilled_volume_usd) : "-"}
          </div>
        </div>
      </div>
      <div className="charts-section">
        <h2>{intervalLabel} Volume (USD)</h2>
        <div className="chart-container">
          {loading ? (
            <div className="loading">Loading chart data...</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={volumes}>
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
                <Legend />
                <Line
                  type="monotone"
                  dataKey="created_volume"
                  name="Created Volume"
                  stroke="#4f46e5"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="fulfilled_volume"
                  name="Fulfilled Volume"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      <div className="charts-section">
        <h2>{intervalLabel} Order Count</h2>
        <div className="chart-container">
          {loading ? (
            <div className="loading">Loading chart data...</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumes}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip labelStyle={{ fontWeight: "bold" }} />
                <Legend />
                <Bar
                  dataKey="created_count"
                  name="Created Orders"
                  fill="#4f46e5"
                />
                <Bar
                  dataKey="fulfilled_count"
                  name="Fulfilled Orders"
                  fill="#10b981"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      <div className="orders-section">
        <h2>Recent Orders ({formatNumber(ordersTotal)} total)</h2>
        {loading ? (
          <div className="loading">Loading orders...</div>
        ) : (
          <>
            <table className="orders-table">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Type</th>
                  <th>Time</th>
                  <th>Value (USD)</th>
                  <th>Signature</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={`${order.order_id}-${order.event_type}`}>
                    <td className="order-id">
                      {order.order_id.slice(0, 8)}...{order.order_id.slice(-8)}
                    </td>
                    <td>
                      <span className={`event-type ${order.event_type}`}>
                        {order.event_type}
                      </span>
                    </td>
                    <td>{new Date(order.block_time).toLocaleString()}</td>
                    <td>
                      {order.usd_value != null && order.usd_value > 0
                        ? formatUsd(order.usd_value)
                        : "-"}
                    </td>
                    <td className="order-id">
                      <a
                        href={`https://solscan.io/tx/${order.tx_signature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {order.tx_signature.slice(0, 8)}...
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pagination">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </button>
              <span>
                Page {page} of {totalPages || 1}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
