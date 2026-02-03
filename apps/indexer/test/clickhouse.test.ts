import { describe, it } from "mocha";
import { expect } from "chai";
import { Clickhouse } from "@dln/shared";

describe("ClickHouse query shaping", () => {
  it("adds date filters when from/to are provided", async () => {
    const clickhouse = new Clickhouse("http://localhost:8123");
    const calls: Array<{ query: string; params: Record<string, string> }> = [];
    const clickhouseAny = clickhouse as unknown as {
      client: {
        query: (args: {
          query: string;
          query_params: Record<string, string>;
          format: string;
        }) => Promise<{ json: () => Promise<unknown[]> }>;
      };
    };
    clickhouseAny.client = {
      query: async (args) => {
        calls.push({ query: args.query, params: args.query_params });
        return { json: async () => [] };
      },
    };
    await clickhouse.getDailyVolume({
      eventType: "created",
      from: "2024-01-01",
      to: "2024-01-31",
    });
    expect(calls).to.have.length(1);
    expect(calls[0].query).to.include(
      "WHERE event_type = {eventType:String} AND date >= {from:Date} AND date <= {to:Date}",
    );
    expect(calls[0].params).to.deep.equal({
      eventType: "created",
      from: "2024-01-01",
      to: "2024-01-31",
    });
  });
  it("omits date filters when from/to are missing", async () => {
    const clickhouse = new Clickhouse("http://localhost:8123");
    const calls: Array<{ query: string; params: Record<string, string> }> = [];
    const clickhouseAny = clickhouse as unknown as {
      client: {
        query: (args: {
          query: string;
          query_params: Record<string, string>;
          format: string;
        }) => Promise<{ json: () => Promise<unknown[]> }>;
      };
    };
    clickhouseAny.client = {
      query: async (args) => {
        calls.push({ query: args.query, params: args.query_params });
        return { json: async () => [] };
      },
    };
    await clickhouse.getDailyVolume({ eventType: "fulfilled" });
    expect(calls).to.have.length(1);
    expect(calls[0].query).to.include("WHERE event_type = {eventType:String}");
    expect(calls[0].query).to.not.include("date >=");
    expect(calls[0].query).to.not.include("date <=");
    expect(calls[0].params).to.deep.equal({ eventType: "fulfilled" });
  });
});
