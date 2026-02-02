export type ProgramType = "src" | "dst";

export interface Checkpoint {
    lastSignature: string;
    blockTime: number;
}

export interface CheckpointStore {
    getCheckpoint(program: ProgramType): Promise<Checkpoint | null>;
    setCheckpoint(program: ProgramType, checkpoint: Checkpoint): Promise<void>;
    close(): Promise<void>;
}
