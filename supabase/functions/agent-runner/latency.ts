export type LatencyEntry = {
  stage: string;
  duration_ms: number;
  ok?: boolean;
  status?: number;
  correlation_id?: string | null;
  phone?: string | null;
};

export function maskPhone(phone?: string | null): string | null {
  if (!phone || phone.length <= 9) return phone ?? null;
  return `${phone.slice(0, 5)}***${phone.slice(-4)}`;
}

export function getToolLatencyLabel(toolName: string): string {
  return `tool:${toolName}`;
}

export function getHotspotReport(entries: LatencyEntry[]) {
  if (!entries.length) {
    return { slowest_stage: null, slowest_duration_ms: 0, total_duration_ms: 0 };
  }

  const slowest = entries.reduce((current, entry) =>
    entry.duration_ms > current.duration_ms ? entry : current
  );

  return {
    slowest_stage: slowest.stage,
    slowest_duration_ms: slowest.duration_ms,
    total_duration_ms: entries.reduce((sum, entry) => sum + entry.duration_ms, 0),
  };
}

function defaultLogger(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ level: "info", scope: "[Agent-Runner]", ...entry }));
}

export function createLatencyTracker(
  meta: { correlationId?: string | null; senderNumber?: string | null },
  logger: (entry: Record<string, unknown>) => void = defaultLogger,
) {
  const entries: LatencyEntry[] = [];

  return {
    entries,
    record(stage: string, duration_ms: number, extra: Record<string, unknown> = {}) {
      const entry: LatencyEntry = {
        stage,
        duration_ms,
        correlation_id: meta.correlationId ?? null,
        phone: maskPhone(meta.senderNumber),
        ...(extra as Partial<LatencyEntry>),
      };

      entries.push(entry);
      logger({ event: "text_path_stage", ...entry });
      return entry;
    },
    finish(outcome: string, extra: Record<string, unknown> = {}) {
      const report = getHotspotReport(entries);
      logger({
        event: "text_path_hotspot",
        correlation_id: meta.correlationId ?? null,
        phone: maskPhone(meta.senderNumber),
        outcome,
        stage_count: entries.length,
        ...report,
        ...extra,
      });
      return report;
    },
  };
}

export async function timeAsync<T>(
  tracker: ReturnType<typeof createLatencyTracker> | null,
  stage: string,
  run: () => Promise<T>,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await run();
    tracker?.record(stage, Date.now() - startedAt, { ok: true, ...extra });
    return result;
  } catch (error: any) {
    tracker?.record(stage, Date.now() - startedAt, {
      ok: false,
      error_name: error?.name ?? "Error",
      ...extra,
    });
    throw error;
  }
}
