import { describe, it } from "mocha";
import { expect } from "chai";
import type { ConfirmedSignatureInfo } from "@solana/web3.js";
import type { Analytics } from "@dln/shared";
import type { CheckpointStore } from "../src/checkpoint";
import type { SolanaClient } from "../src/solana";
import { Indexer } from "../src/indexer";

describe("Checkpoint advance rules", () => {
    it("updates from/to based on direction", async () => {
        const store: CheckpointStore = {
            getCheckpoint: async () => null,
            setCheckpoint: async () => {},
            close: async () => {},
        };
        const analytics: Analytics = {
            insertOrders: async () => {},
            getOrderCount: async () => 0,
            close: async () => {},
        };
        const indexer = new Indexer({} as unknown as SolanaClient, store, analytics, "OrderCreated");
        const indexerAny = indexer as unknown as {
            updateCheckpoint: (sigInfo: ConfirmedSignatureInfo, direction: "forward" | "backward") => Promise<void>;
            lastCheckpointSaveTime: number;
        };
        indexerAny.lastCheckpointSaveTime = Date.now();
        const sig1 = { signature: "sig1", blockTime: 100, err: null } as ConfirmedSignatureInfo;
        await indexerAny.updateCheckpoint(sig1, "forward");
        const checkpoint1 = indexer.getCheckpoint();
        expect(checkpoint1?.from.signature).to.equal("sig1");
        expect(checkpoint1?.to.signature).to.equal("sig1");
        const sig2 = { signature: "sig2", blockTime: 200, err: null } as ConfirmedSignatureInfo;
        await indexerAny.updateCheckpoint(sig2, "forward");
        const checkpoint2 = indexer.getCheckpoint();
        expect(checkpoint2?.from.signature).to.equal("sig1");
        expect(checkpoint2?.to.signature).to.equal("sig2");
        const sig0 = { signature: "sig0", blockTime: 50, err: null } as ConfirmedSignatureInfo;
        await indexerAny.updateCheckpoint(sig0, "backward");
        const checkpoint3 = indexer.getCheckpoint();
        expect(checkpoint3?.from.signature).to.equal("sig0");
        expect(checkpoint3?.to.signature).to.equal("sig2");
    });
});
