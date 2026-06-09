import Database from "better-sqlite3";
import type { Job, JobId, JobState } from "../../domain/job.js";

export interface JobStore {
  get(id: JobId): Job | undefined;
  save(job: Job): void;
  listByState(state: JobState): Job[];
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    scheduled_for TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data TEXT NOT NULL
  )
`;

const CREATE_IDX_STATE = "CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs (state)";

export class SqliteJobStore implements JobStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(CREATE_TABLE);
    this.db.exec(CREATE_IDX_STATE);
  }

  get(id: JobId): Job | undefined {
    const row = this.db
      .prepare<[string], { data: string }>("SELECT data FROM jobs WHERE id = ?")
      .get(id);
    if (!row) return undefined;
    return JSON.parse(row.data) as Job;
  }

  save(job: Job): void {
    const now = new Date().toISOString();
    const persisted: Job = { ...job, updatedAt: now };
    const data = JSON.stringify(persisted);

    this.db
      .prepare<[string, string, string | null, string, string, string]>(
        `INSERT INTO jobs (id, state, scheduled_for, created_at, updated_at, data)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state = excluded.state,
           scheduled_for = excluded.scheduled_for,
           updated_at = excluded.updated_at,
           data = excluded.data`,
      )
      .run(
        persisted.id,
        persisted.state,
        persisted.scheduledFor ?? null,
        persisted.createdAt,
        persisted.updatedAt,
        data,
      );
  }

  listByState(state: JobState): Job[] {
    const rows = this.db
      .prepare<[string], { data: string }>("SELECT data FROM jobs WHERE state = ?")
      .all(state);
    return rows.map((r) => JSON.parse(r.data) as Job);
  }

  close(): void {
    this.db.close();
  }
}
