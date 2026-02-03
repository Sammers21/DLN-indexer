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

interface DailyVolume {
  date: string;
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
  give_amount_usd?: number;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function App() {
  const [volumes, setVolumes] = useState<DailyVolume[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
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
  }, [startDate, endDate, page]);
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  const totalPages = Math.ceil(ordersTotal / 10);
  return (
    <div className="container">
      <header>
        <h1>DLN Order Analytics</h1>
        <div className="date-filters">
          <label>
            From:
            <input
              type="date"
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
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
            />
          </label>
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
        <h2>Daily Volume (USD)</h2>
        <div className="chart-container">
          {loading ? (
            <div className="loading">Loading chart data...</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={volumes}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
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
        <h2>Daily Order Count</h2>
        <div className="chart-container">
          {loading ? (
            <div className="loading">Loading chart data...</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumes}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
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
                      {order.give_amount_usd
                        ? formatUsd(order.give_amount_usd)
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
