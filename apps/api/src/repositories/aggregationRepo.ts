// SQLite 时序数据降采样聚合（1m / 1h 可重入窗口）与分批保留期清理仓储（避免长事务锁库）。
import type { DatabaseHandle } from "./db.ts";

export interface RetentionPolicy {
  rawDays: number;
  agg1mDays: number;
  agg1hDays: number;
  smartDays: number;
  analysisDays?: number;
  eventsDays?: number;
  auditDays?: number;
  batchSize?: number;
}

export interface PruneResult {
  rawDeleted: number;
  agg1mDeleted: number;
  agg1hDeleted: number;
  smartDeleted: number;
  analysisDeleted: number;
  eventsDeleted: number;
  auditDeleted: number;
}

/**
 * Re-entrant time-series aggregation and routine batched retention cleanup
 * (docs/database/schema.md §4–§6).
 */
export class AggregationRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  /**
   * Aggregates raw `sensor_readings` into 1-minute buckets (`YYYY-MM-DDTHH:MM:00Z`).
   * Re-entrant: running repeatedly over the same time range produces identical rows.
   */
  aggregate1m(fromIso: string, toIso: string): number {
    const stmt = this.handle.sqlite.query(`
      INSERT INTO sensor_readings_1m (
        sensor_id, bucket_start, min_value, max_value, avg_value, sample_count, valid_count
      )
      SELECT
        sensor_id,
        substr(collected_at, 1, 16) || ':00Z' AS bucket_start,
        MIN(CASE WHEN quality = 'valid' THEN value ELSE NULL END) AS min_value,
        MAX(CASE WHEN quality = 'valid' THEN value ELSE NULL END) AS max_value,
        AVG(CASE WHEN quality = 'valid' THEN value ELSE NULL END) AS avg_value,
        COUNT(*) AS sample_count,
        SUM(CASE WHEN quality = 'valid' AND value IS NOT NULL THEN 1 ELSE 0 END) AS valid_count
      FROM sensor_readings
      WHERE collected_at >= ? AND collected_at < ?
      GROUP BY sensor_id, bucket_start
      ON CONFLICT(sensor_id, bucket_start) DO UPDATE SET
        min_value = excluded.min_value,
        max_value = excluded.max_value,
        avg_value = excluded.avg_value,
        sample_count = excluded.sample_count,
        valid_count = excluded.valid_count
    `);
    const info = stmt.run(fromIso, toIso);
    return info.changes;
  }

  /**
   * Aggregates `sensor_readings_1m` into 1-hour buckets (`YYYY-MM-DDTHH:00:00Z`).
   * Re-entrant and preserves accurate weighted average using `valid_count`.
   */
  aggregate1h(fromIso: string, toIso: string): number {
    const stmt = this.handle.sqlite.query(`
      INSERT INTO sensor_readings_1h (
        sensor_id, bucket_start, min_value, max_value, avg_value, sample_count, valid_count
      )
      SELECT
        sensor_id,
        substr(bucket_start, 1, 13) || ':00:00Z' AS hour_bucket,
        MIN(min_value) AS min_value,
        MAX(max_value) AS max_value,
        CASE
          WHEN SUM(valid_count) > 0 THEN SUM(avg_value * valid_count) / SUM(valid_count)
          ELSE NULL
        END AS avg_value,
        SUM(sample_count) AS sample_count,
        SUM(valid_count) AS valid_count
      FROM sensor_readings_1m
      WHERE bucket_start >= ? AND bucket_start < ?
      GROUP BY sensor_id, hour_bucket
      ON CONFLICT(sensor_id, bucket_start) DO UPDATE SET
        min_value = excluded.min_value,
        max_value = excluded.max_value,
        avg_value = excluded.avg_value,
        sample_count = excluded.sample_count,
        valid_count = excluded.valid_count
    `);
    const info = stmt.run(fromIso, toIso);
    return info.changes;
  }

  /**
   * Routine retention cleanup in bounded batches to avoid long SQLite write locks.
   * Only deletes expired raw readings whose 1-minute bucket already exists in `sensor_readings_1m`.
   */
  pruneExpired(policy: RetentionPolicy, nowMs: number = Date.now()): PruneResult {
    const batch = Math.max(policy.batchSize ?? 5000, 100);
    const cutoff = (days: number) =>
      new Date(nowMs - days * 86_400_000).toISOString();

    const rawCutoff = cutoff(policy.rawDays);
    const agg1mCutoff = cutoff(policy.agg1mDays);
    const agg1hCutoff = cutoff(policy.agg1hDays);
    const smartCutoff = cutoff(policy.smartDays);

    const deleteChunk = (sqlText: string, cutoffIso: string): number => {
      let total = 0;
      const stmt = this.handle.sqlite.query(sqlText);
      while (true) {
        const res = stmt.run(cutoffIso, batch);
        total += res.changes;
        if (res.changes < batch) break;
      }
      return total;
    };

    const rawDeleted = deleteChunk(
      `DELETE FROM sensor_readings WHERE id IN (
        SELECT sr.id FROM sensor_readings sr
        WHERE sr.collected_at < ?
          AND EXISTS (
            SELECT 1 FROM sensor_readings_1m m
            WHERE m.sensor_id = sr.sensor_id
              AND m.bucket_start = substr(sr.collected_at, 1, 16) || ':00Z'
          )
        LIMIT ?
      )`,
      rawCutoff,
    );

    const agg1mDeleted = deleteChunk(
      `DELETE FROM sensor_readings_1m WHERE id IN (
        SELECT id FROM sensor_readings_1m WHERE bucket_start < ? LIMIT ?
      )`,
      agg1mCutoff,
    );

    const agg1hDeleted = deleteChunk(
      `DELETE FROM sensor_readings_1h WHERE id IN (
        SELECT id FROM sensor_readings_1h WHERE bucket_start < ? LIMIT ?
      )`,
      agg1hCutoff,
    );

    const smartDeleted = deleteChunk(
      `DELETE FROM smart_devices WHERE id IN (
        SELECT id FROM smart_devices WHERE collected_at < ? LIMIT ?
      )`,
      smartCutoff,
    );

    const analysisCutoff = cutoff(policy.analysisDays ?? 90);
    const eventsCutoff = cutoff(policy.eventsDays ?? 90);
    const auditCutoff = cutoff(policy.auditDays ?? 365);

    const analysisDeleted = deleteChunk(
      `DELETE FROM analysis_results WHERE id IN (
        SELECT id FROM analysis_results WHERE analyzed_at < ? LIMIT ?
      )`,
      analysisCutoff,
    );

    const eventsDeleted = deleteChunk(
      `DELETE FROM health_events WHERE id IN (
        SELECT id FROM health_events WHERE occurred_at < ? LIMIT ?
      )`,
      eventsCutoff,
    );

    const auditDeleted = deleteChunk(
      `DELETE FROM audit_logs WHERE id IN (
        SELECT id FROM audit_logs WHERE occurred_at < ? LIMIT ?
      )`,
      auditCutoff,
    );

    return {
      rawDeleted,
      agg1mDeleted,
      agg1hDeleted,
      smartDeleted,
      analysisDeleted,
      eventsDeleted,
      auditDeleted,
    };
  }
}
