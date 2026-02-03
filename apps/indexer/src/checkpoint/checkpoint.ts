export type ProgramType = "src" | "dst";

export interface CheckpointBoundary {
  signature: string;
  blockTime: number;
}

export interface Checkpoint {
  from: CheckpointBoundary; // oldest indexed signature
  to: CheckpointBoundary; // newest indexed signature
}

export interface CheckpointStore {
  getCheckpoint(program: ProgramType): Promise<Checkpoint | null>;
  setCheckpoint(program: ProgramType, checkpoint: Checkpoint): Promise<void>;
  close(): Promise<void>;
}
