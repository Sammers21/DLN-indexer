import { describe, it } from "mocha";
import { expect } from "chai";
import type { ConfirmedSignatureInfo } from "@solana/web3.js";
import type { Analytics, Order } from "@dln/shared";
import type { CheckpointStore, Checkpoint, ProgramType } from "../src/checkpoint";
import type { SolanaClient } from "../src/solana";
import { Indexer } from "../src/indexer";

function makeSigInfo(signature: string, blockTime: number, err: unknown = null): ConfirmedSignatureInfo {
    return { signature, blockTime, err, memo: null, slot: 0, confirmationStatus: "confirmed" } as ConfirmedSignatureInfo;
}

function createMockStore(): CheckpointStore & { saved: Array<{ program: ProgramType; checkpoint: Checkpoint }> } {
    const saved: Array<{ program: ProgramType; checkpoint: Checkpoint }> = [];
    return {
        saved,
        getCheckpoint: async () => null,
        setCheckpoint: async (program, checkpoint) => { saved.push({ program, checkpoint }); },
        close: async () => {},
    };
}

function createMockAnalytics(): Analytics & { inserted: Order[] } {
    const inserted: Order[] = [];
    return {
        inserted,
        insertOrders: async (orders) => { inserted.push(...orders); },
        getOrderCount: async () => 0,
        close: async () => {},
    };
}

describe("Indexer", () => {
    describe("checkpoint initialization", () => {
        it("starts with null checkpoint when store returns null", () => {
            const store = createMockStore();
            const analytics = createMockAnalytics();
            const indexer = new Indexer({} as unknown as SolanaClient, store, analytics, "OrderCreated");
            expect(indexer.getCheckpoint()).to.equal(null);
        });
    });

    describe("updateCheckpoint", () => {
        it("initializes checkpoint on first signature", async () => {
            const store = createMockStore();
            const analytics = createMockAnalytics();
            const indexer = new Indexer({} as unknown as SolanaClient, store, analytics, "OrderCreated");
            const internal = indexer as unknown as {
                updateCheckpoint: (sig: ConfirmedSignatureInfo, dir: "forward" | "backward") => Promise<void>;
                lastCheckpointSaveTime: number;
            };
            internal.lastCheckpointSaveTime = Date.now();

            await internal.updateCheckpoint(makeSigInfo("sig-first", 1000), "forward");

            const cp = indexer.getCheckpoint();
            expect(cp).to.not.equal(null);
            expect(cp!.from.signature).to.equal("sig-first");
            expect(cp!.to.signature).to.equal("sig-first");
            expect(cp!.from.blockTime).to.equal(1000);
        });

        it("updates 'to' boundary on forward direction", async () => {
            const store = createMockStore();
            const analytics = createMockAnalytics();
            const indexer = new Indexer({} as unknown as SolanaClient, store, analytics, "OrderFulfilled");
            const internal = indexer as unknown as {
                updateCheckpoint: (sig: ConfirmedSignatureInfo, dir: "forward" | "backward") => Promise<void>;
                lastCheckpointSaveTime: number;
            };
            internal.lastCheckpointSaveTime = Date.now();

            await internal.updateCheckpoint(makeSigInfo("sig-a", 100), "forward");
            await internal.updateCheckpoint(makeSigInfo("sig-b", 200), "forward");

            const cp = indexer.getCheckpoint();
            expect(cp!.from.signature).to.equal("sig-a");
            expect(cp!.to.signature).to.equal("sig-b");
        });

        it("updates 'from' boundary on backward direction", async () => {
            const store = createMockStore();
            const analytics = createMockAnalytics();
            const indexer = new Indexer({} as unknown as SolanaClient, store, analytics, "OrderCreated");
            const internal = indexer as unknown as {
                updateCheckpoint: (sig: ConfirmedSignatureInfo, dir: "forward" | "backward") => Promise<void>;
                lastCheckpointSaveTime: number;
            };
            internal.lastCheckpointSaveTime = Date.now();

            await internal.updateCheckpoint(makeSigInfo("sig-a", 100), "forward");
            await internal.updateCheckpoint(makeSigInfo("sig-old", 50), "backward");

            const cp = indexer.getCheckpoint();
            expect(cp!.from.signature).to.equal("sig-old");
            expect(cp!.to.signature).to.equal("sig-a");
        });

        it("persists to store when save interval elapsed", async () => {
            const store = createMockStore();
            const analytics = createMockAnalytics();
            const indexer = new Indexer({} as unknown as SolanaClient, store, analytics, "OrderCreated");
            const internal = indexer as unknown as {
                updateCheckpoint: (sig: ConfirmedSignatureInfo, dir: "forward" | "backward") => Promise<void>;
                lastCheckpointSaveTime: number;
            };
            // Set last save time to far in the past to trigger a save
            internal.lastCheckpointSaveTime = Date.now() - 5000;

            await internal.updateCheckpoint(makeSigInfo("sig-persist", 300), "forward");

            expect(store.saved.length).to.be.greaterThanOrEqual(1);
            expect(store.saved[0].program).to.equal("src");
        });

        it("does not persist when within save interval", async () => {
            const store = createMockStore();
            const analytics = createMockAnalytics();
            const indexer = new Indexer({} as unknown as SolanaClient, store, analytics, "OrderCreated");
            const internal = indexer as unknown as {
                updateCheckpoint: (sig: ConfirmedSignatureInfo, dir: "forward" | "backward") => Promise<void>;
                lastCheckpointSaveTime: number;
            };
            // Set last save time to now (within 1s interval)
            internal.lastCheckpointSaveTime = Date.now();

            await internal.updateCheckpoint(makeSigInfo("sig-no-persist", 300), "forward");

            expect(store.saved.length).to.equal(0);
        });

        it("uses current time as fallback when blockTime is null", async () => {
            const store = createMockStore();
            const analytics = createMockAnalytics();
            const indexer = new Indexer({} as unknown as SolanaClient, store, analytics, "OrderCreated");
            const internal = indexer as unknown as {
                updateCheckpoint: (sig: ConfirmedSignatureInfo, dir: "forward" | "backward") => Promise<void>;
                lastCheckpointSaveTime: number;
            };
            internal.lastCheckpointSaveTime = Date.now();

            const sigInfo = { signature: "sig-no-time", blockTime: null, err: null, memo: null, slot: 0 } as unknown as ConfirmedSignatureInfo;
            await internal.updateCheckpoint(sigInfo, "forward");

            const cp = indexer.getCheckpoint();
            // blockTime should be approximately current time in seconds
            const nowSec = Math.floor(Date.now() / 1000);
            expect(cp!.from.blockTime).to.be.closeTo(nowSec, 5);
        });
    });

    describe("handleSignature", () => {
        it("skips failed transactions but still updates checkpoint", async () => {
            const store = createMockStore();
            const analytics = createMockAnalytics();
            const indexer = new Indexer({} as unknown as SolanaClient, store, analytics, "OrderCreated");
            const internal = indexer as unknown as {
                handleSignature: (sig: ConfirmedSignatureInfo, dir: "forward" | "backward") => Promise<void>;
                lastCheckpointSaveTime: number;
            };
            internal.lastCheckpointSaveTime = Date.now();

            const failedSig = makeSigInfo("sig-failed", 100, { InstructionError: [0, "Custom"] });
            await internal.handleSignature(failedSig, "forward");

            // Checkpoint should still be updated
            const cp = indexer.getCheckpoint();
            expect(cp).to.not.equal(null);
            expect(cp!.to.signature).to.equal("sig-failed");
            // No orders should have been inserted
            expect(analytics.inserted).to.have.length(0);
        });
    });

    describe("constructor program mapping", () => {
        it("maps OrderCreated to src program type", () => {
            const store = createMockStore();
            const analytics = createMockAnalytics();
            const indexer = new Indexer({} as unknown as SolanaClient, store, analytics, "OrderCreated");
            const internal = indexer as unknown as { programType: string };
            expect(internal.programType).to.equal("src");
        });

        it("maps OrderFulfilled to dst program type", () => {
            const store = createMockStore();
            const analytics = createMockAnalytics();
            const indexer = new Indexer({} as unknown as SolanaClient, store, analytics, "OrderFulfilled");
            const internal = indexer as unknown as { programType: string };
            expect(internal.programType).to.equal("dst");
        });
    });

    describe("stop", () => {
        it("sets running to false", () => {
            const store = createMockStore();
            const analytics = createMockAnalytics();
            const indexer = new Indexer({} as unknown as SolanaClient, store, analytics, "OrderCreated");
            const internal = indexer as unknown as { running: boolean };
            internal.running = true;
            indexer.stop();
            expect(internal.running).to.equal(false);
        });
    });
});
