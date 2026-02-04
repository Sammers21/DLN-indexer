import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import { SolanaClient } from "../src/solana";

describe("SolanaClient", () => {
  let client: SolanaClient;

  beforeEach(() => {
    // Use a high RPS to avoid slow rate-limiting delays in tests
    client = new SolanaClient("https://localhost:0", 100);
  });

  describe("constructor", () => {
    it("creates a client with custom RPC URL and RPS", () => {
      const c = new SolanaClient("https://custom-rpc.example.com", 50);
      expect(c).to.be.instanceOf(SolanaClient);
    });

    it("creates a client with default config when no args provided", () => {
      const c = new SolanaClient();
      expect(c).to.be.instanceOf(SolanaClient);
    });
  });

  describe("withRetry", () => {
    it("retries on 429 errors with exponential backoff", async () => {
      const internal = client as unknown as {
        withRetry: <T>(
          name: string,
          fn: () => Promise<T>,
        ) => Promise<{ result: T; timeMs: number }>;
      };

      let callCount = 0;
      const fn = async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error("429 Too Many Requests");
        }
        return "success";
      };

      const { result } = await internal.withRetry("getTransaction", fn);
      expect(result).to.equal("success");
      expect(callCount).to.equal(3);
    });

    it("retries on generic errors", async () => {
      const internal = client as unknown as {
        withRetry: <T>(
          name: string,
          fn: () => Promise<T>,
        ) => Promise<{ result: T; timeMs: number }>;
      };

      let callCount = 0;
      const fn = async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error("Connection reset");
        }
        return 42;
      };

      const { result } = await internal.withRetry(
        "getSignaturesForAddress",
        fn,
      );
      expect(result).to.equal(42);
      expect(callCount).to.equal(2);
    });

    it("throws after max retries exhausted", async function () {
      this.timeout(35000); // Allow for exponential backoff delays
      const internal = client as unknown as {
        withRetry: <T>(
          name: string,
          fn: () => Promise<T>,
        ) => Promise<{ result: T; timeMs: number }>;
      };

      const fn = async (): Promise<string> => {
        throw new Error("Persistent failure");
      };

      try {
        await internal.withRetry("getTransaction", fn);
        expect.fail("Should have thrown");
      } catch (err) {
        expect((err as Error).message).to.equal("Persistent failure");
      }
    });

    it("records metrics on success", async () => {
      const internal = client as unknown as {
        withRetry: <T>(
          name: string,
          fn: () => Promise<T>,
        ) => Promise<{ result: T; timeMs: number }>;
        metrics: Record<
          string,
          { count: number; totalMs: number; errorCount: number }
        >;
      };

      await internal.withRetry("getTransaction", async () => "ok");

      expect(internal.metrics.getTransaction.count).to.equal(1);
      expect(internal.metrics.getTransaction.errorCount).to.equal(0);
      expect(internal.metrics.getTransaction.totalMs).to.be.greaterThanOrEqual(
        0,
      );
    });
  });

  describe("recordMetrics", () => {
    it("increments count and totalMs on success", () => {
      const internal = client as unknown as {
        recordMetrics: (
          method: string,
          timeMs: number | null,
          failed: boolean,
        ) => void;
        metrics: Record<
          string,
          { count: number; totalMs: number; errorCount: number }
        >;
      };

      internal.recordMetrics("getTransaction", 150, false);
      expect(internal.metrics.getTransaction.count).to.equal(1);
      expect(internal.metrics.getTransaction.totalMs).to.equal(150);
      expect(internal.metrics.getTransaction.errorCount).to.equal(0);
    });

    it("increments errorCount on failure", () => {
      const internal = client as unknown as {
        recordMetrics: (
          method: string,
          timeMs: number | null,
          failed: boolean,
        ) => void;
        metrics: Record<
          string,
          { count: number; totalMs: number; errorCount: number }
        >;
      };

      internal.recordMetrics("getSignaturesForAddress", null, true);
      expect(internal.metrics.getSignaturesForAddress.errorCount).to.equal(1);
      expect(internal.metrics.getSignaturesForAddress.count).to.equal(0);
    });

    it("does not increment count when timeMs is null", () => {
      const internal = client as unknown as {
        recordMetrics: (
          method: string,
          timeMs: number | null,
          failed: boolean,
        ) => void;
        metrics: Record<
          string,
          { count: number; totalMs: number; errorCount: number }
        >;
      };

      internal.recordMetrics("getTransaction", null, true);
      expect(internal.metrics.getTransaction.count).to.equal(0);
      expect(internal.metrics.getTransaction.totalMs).to.equal(0);
    });
  });

  describe("maybeLogMetrics", () => {
    it("logs and resets metrics after interval elapsed", () => {
      const internal = client as unknown as {
        recordMetrics: (
          method: string,
          timeMs: number | null,
          failed: boolean,
        ) => void;
        maybeLogMetrics: () => void;
        lastMetricsLogMs: number;
        metrics: Record<
          string,
          { count: number; totalMs: number; errorCount: number }
        >;
      };

      internal.recordMetrics("getTransaction", 100, false);
      internal.recordMetrics("getTransaction", 200, false);

      // Force metrics log by setting last log time far in the past
      internal.lastMetricsLogMs = Date.now() - 120000;
      internal.maybeLogMetrics();

      // Metrics should be reset
      expect(internal.metrics.getTransaction.count).to.equal(0);
      expect(internal.metrics.getTransaction.totalMs).to.equal(0);
    });

    it("does not log when interval has not elapsed", () => {
      const internal = client as unknown as {
        recordMetrics: (
          method: string,
          timeMs: number | null,
          failed: boolean,
        ) => void;
        maybeLogMetrics: () => void;
        lastMetricsLogMs: number;
        metrics: Record<
          string,
          { count: number; totalMs: number; errorCount: number }
        >;
      };

      internal.recordMetrics("getTransaction", 100, false);
      internal.lastMetricsLogMs = Date.now();
      internal.maybeLogMetrics();

      // Metrics should NOT be reset
      expect(internal.metrics.getTransaction.count).to.equal(1);
    });
  });

  describe("buildMetricsSnapshot", () => {
    it("computes average ms correctly", () => {
      const internal = client as unknown as {
        recordMetrics: (
          method: string,
          timeMs: number | null,
          failed: boolean,
        ) => void;
        buildMetricsSnapshot: (method: string) => {
          count: number;
          errorCount: number;
          avgMs: number;
        };
      };

      internal.recordMetrics("getTransaction", 100, false);
      internal.recordMetrics("getTransaction", 300, false);

      const snapshot = internal.buildMetricsSnapshot("getTransaction");
      expect(snapshot.count).to.equal(2);
      expect(snapshot.avgMs).to.equal(200);
      expect(snapshot.errorCount).to.equal(0);
    });

    it("returns 0 avgMs when count is 0", () => {
      const internal = client as unknown as {
        buildMetricsSnapshot: (method: string) => {
          count: number;
          errorCount: number;
          avgMs: number;
        };
      };

      const snapshot = internal.buildMetricsSnapshot("getSignaturesForAddress");
      expect(snapshot.avgMs).to.equal(0);
    });
  });
});
