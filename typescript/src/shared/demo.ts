import { DEMO_ASSET_BASE_URL, DEMO_ASSETS, type DemoAsset } from "./demo-assets.js";
import type { Job, JobStatus, JobStatusResponse, Quote, QuoteParameters } from "./types.js";

/**
 * Demo outcome. `ok` succeeds, `slow` stays queued for 6 minutes (past the default
 * `waitForJob` timeout) before succeeding, `fail` fails with nothing charged,
 * `reject` makes the submit itself throw 422 `YIR_INPUT_REJECTED`, and `cancel`
 * ends `cancelled`. A `[demo:<scenario>]` marker in the prompt overrides the client option.
 */
export type YirDemoScenario = "ok" | "slow" | "fail" | "reject" | "cancel";

export type YirDemoOptions = {
  readonly scenario?: YirDemoScenario;
};

export { DEMO_ASSET_BASE_URL };

// The Job ID carries everything a later read needs, so any process or Workers
// instance derives the same Job without shared state:
//   demo_1 <created:6> <kind> <aspect> <n> <duration:2> <resolution> <scenario> <nonce:4> _ <model, "/" as "~">
// The code lists below are append-only.
const PREFIX = "demo_1";
const HEAD = PREFIX.length + 17;
const MAX_MODEL_LENGTH = 64 - HEAD - 1;
const KINDS = { i: "image", v: "video", m: "music", x: "sound_effect", t: "speech" } as const;
type DemoKind = (typeof KINDS)[keyof typeof KINDS];
const OPERATION_KINDS: Readonly<Record<string, keyof typeof KINDS>> = {
  generate_image: "i", generate_video: "v", generate_music: "m", generate_sound_effect: "x", generate_speech: "t",
};
const ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21", "4:5", "5:4", "2:1", "1:2", "3:1", "1:3", "4:1", "1:4", "8:1", "1:8", "auto", "adaptive"];
const RESOLUTIONS = ["480p", "720p", "1080p", "768P", "0.5K", "1K", "2K", "3K", "4K", "1MP", "native", "540p", "1440p", "2160p"];
const SCENARIOS: Readonly<Record<YirDemoScenario, string>> = { ok: "o", slow: "s", fail: "f", reject: "r", cancel: "c" };
const AUTO_DURATION = 36 * 36 - 1;
const ID_PATTERN = /^demo_1[0-9a-z]{6}[imxtv][0-9a-z][1-9a-z][0-9a-z]{2}[0-9a-z][osfrc][0-9a-z]{4}_[a-z0-9._~-]+$/;

// Seconds after creation: [running, terminal]. `slow` queues for 6 minutes.
const TIMELINE: Readonly<Record<DemoKind, readonly [number, number]>> = {
  image: [2, 8], video: [3, 25], music: [2, 12], sound_effect: [2, 12], speech: [2, 12],
};
const SLOW_TIMELINE = [360, 480] as const;
const RESULT_TTL_SECONDS = 7 * 24 * 3600;

type DemoJobFields = {
  readonly id: string;
  readonly created: number;
  readonly kind: DemoKind;
  readonly aspectRatio?: string;
  readonly n: number;
  readonly duration?: number | "auto";
  readonly resolution?: string;
  readonly scenario: YirDemoScenario;
  readonly model: string;
};

/** Reports whether an ID belongs to a demo-mode Job, which the SDK answers locally. */
export function isDemoJobID(id: unknown): id is string {
  return typeof id === "string" && id.length <= 64 && ID_PATTERN.test(id);
}

const code = (list: readonly string[], value: unknown) => {
  const index = typeof value === "string" ? list.indexOf(value) : -1;
  return index < 0 ? "0" : (index + 1).toString(36);
};

/** Scenario of a submit: a `[demo:<scenario>]` prompt marker wins over the client option. */
export function demoScenario(request: { readonly input?: { readonly prompt?: unknown } }, options: YirDemoOptions): YirDemoScenario {
  const prompt = request.input?.prompt;
  const marker = typeof prompt === "string" ? /\[demo:(ok|slow|fail|reject|cancel)\]/i.exec(prompt)?.[1]?.toLowerCase() : undefined;
  return (marker ?? options.scenario ?? "ok") as YirDemoScenario;
}

export function validateDemoOptions(options: YirDemoOptions): void {
  if (options.scenario !== undefined && !Object.hasOwn(SCENARIOS, options.scenario)) throw new Error("demo_scenario_invalid");
}

/** Builds the queued demo Job for a successful quote of the submitted request. */
export function createDemoJob(quote: Quote, scenario: YirDemoScenario, now = Date.now()): Job {
  const model = quote.model.replace(/\//g, "~");
  if (model.length > MAX_MODEL_LENGTH) throw new Error("demo_model_id_too_long");
  const parameters = quote.parameters;
  const n = Math.min(Math.max(Math.trunc(parameters.n) || 1, 1), 35);
  const duration = parameters.duration === "auto" ? AUTO_DURATION
    : typeof parameters.duration === "number" ? Math.min(Math.max(Math.round(parameters.duration), 0), AUTO_DURATION - 1) : 0;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(4)), byte => (byte % 36).toString(36)).join("");
  const id = PREFIX + Math.floor(now / 1000).toString(36).padStart(6, "0") +
    (OPERATION_KINDS[quote.operation] ?? "i") + code(ASPECTS, parameters.aspect_ratio) + n.toString(36) +
    duration.toString(36).padStart(2, "0") + code(RESOLUTIONS, parameters.resolution) + SCENARIOS[scenario] + nonce + "_" + model;
  return { ...demoJob(decode(id), now), parameters };
}

function decode(id: string): DemoJobFields {
  const field = (start: number, length = 1) => parseInt(id.slice(PREFIX.length + start, PREFIX.length + start + length), 36);
  const listed = (list: readonly string[], index: number) => index > 0 ? list[index - 1] : undefined;
  const duration = field(9, 2);
  const scenario = id[PREFIX.length + 12];
  return {
    id,
    created: field(0, 6),
    kind: KINDS[id[PREFIX.length + 6] as keyof typeof KINDS],
    aspectRatio: listed(ASPECTS, field(7)),
    n: field(8),
    duration: duration === AUTO_DURATION ? "auto" : duration > 0 ? duration : undefined,
    resolution: listed(RESOLUTIONS, field(11)),
    scenario: (Object.keys(SCENARIOS) as YirDemoScenario[]).find(name => SCENARIOS[name] === scenario) ?? "ok",
    model: id.slice(HEAD + 1).replace(/~/g, "/"),
  };
}

function timeline(fields: DemoJobFields): readonly [number, number] {
  const [running, terminal] = fields.scenario === "slow" ? SLOW_TIMELINE : TIMELINE[fields.kind];
  return [fields.created + running, fields.created + terminal];
}

function statusAt(fields: DemoJobFields, seconds: number): JobStatus {
  const [running, terminal] = timeline(fields);
  if (seconds < running) return "queued";
  if (seconds < terminal) return "running";
  return fields.scenario === "fail" ? "failed" : fields.scenario === "cancel" ? "cancelled" : "succeeded";
}

/** Milliseconds until the demo Job's next status change, or undefined once it is terminal. */
export function demoJobNextChangeMs(id: string, now = Date.now()): number | undefined {
  const next = timeline(decode(id)).find(at => at * 1000 > now);
  return next === undefined ? undefined : next * 1000 - now;
}

const ratio = (aspect: string | undefined) => {
  const match = /^(\d+):(\d+)$/.exec(aspect ?? "");
  return match ? Number(match[1]) / Number(match[2]) : undefined;
};

// The nearest published aspect (and video length); results report the real file's size.
function assets(fields: DemoJobFields): readonly DemoAsset[] {
  const candidates = DEMO_ASSETS.filter(asset => asset.kind === fields.kind);
  if (fields.kind !== "image" && fields.kind !== "video") return candidates;
  const wanted = ratio(fields.aspectRatio) ?? (fields.kind === "image" ? 1 : 16 / 9);
  const distance = (asset: DemoAsset) => Math.abs(Math.log(ratio(asset.aspect_ratio)! / wanted));
  const best = Math.min(...candidates.map(distance));
  let matching = candidates.filter(asset => distance(asset) === best);
  if (fields.kind === "video") {
    const seconds = typeof fields.duration === "number" ? fields.duration : 5;
    const length = Math.min(...matching.map(asset => Math.abs(asset.duration! - seconds)));
    matching = matching.filter(asset => Math.abs(asset.duration! - seconds) === length);
  }
  return matching;
}

function demoJob(fields: DemoJobFields, now: number, cancelledAt?: number): Job {
  const seconds = Math.floor(now / 1000);
  const status = cancelledAt === undefined ? statusAt(fields, seconds) : "cancelled";
  const completed = cancelledAt ?? timeline(fields)[1];
  const terminal = status === "succeeded" || status === "failed" || status === "cancelled";
  const parameters: Record<string, unknown> = { n: fields.n };
  if (fields.aspectRatio !== undefined) parameters.aspect_ratio = fields.aspectRatio;
  if (fields.resolution !== undefined) parameters.resolution = fields.resolution;
  if (fields.duration !== undefined) parameters.duration = fields.duration;
  const files = status !== "succeeded" ? [] : Array.from({ length: fields.n }, (_, index) => {
    const pool = assets(fields);
    const asset = pool[index % pool.length]!;
    return {
      url: DEMO_ASSET_BASE_URL + asset.path + (index >= pool.length ? `?i=${index}` : ""),
      media_type: asset.media_type,
      ...(asset.width !== undefined ? { width: asset.width, height: asset.height } : {}),
      ...(asset.duration_ms !== undefined ? { duration_ms: asset.duration_ms } : {}),
      expires_at: completed + RESULT_TTL_SECONDS,
    };
  });
  return {
    id: fields.id,
    object: "job",
    status,
    model: fields.model,
    parameters: parameters as QuoteParameters,
    urls: { get: `/v1/jobs/${fields.id}`, cancel: `/v1/jobs/${fields.id}/cancel` },
    error: status === "failed"
      ? { code: "YIR_EXECUTION_FAILED", message: "Demo Job failed by the fail scenario; nothing was charged.", retryable: false }
      : null,
    created_at: fields.created,
    ...(terminal ? { completed_at: completed } : {}),
    ...(status === "cancelled" ? { cancellation: { status: "cancelled" as const, requested_at: completed } } : {}),
    ...(status === "succeeded" ? {
      final_provider: "yir-demo",
      usage: { outputs: fields.n },
      result: { availability: "available" as const, files },
    } : {}),
    billing: {
      currency: "USD",
      total_charged_by_yir: "0",
      status: terminal ? "settled" : "pending",
      compute_charges: [],
      gateway_fee: { amount: "0", status: "waived" },
    },
  };
}

/** The demo Job as of `now`; the ID must satisfy `isDemoJobID`. */
export function getDemoJob(id: string, now = Date.now()): Job {
  return demoJob(decode(id), now);
}

export function getDemoJobStatus(id: string, now = Date.now()): JobStatusResponse {
  const job = getDemoJob(id, now);
  return { id: job.id, status: job.status, error: job.error, ...(job.cancellation ? { cancellation: job.cancellation } : {}) };
}

/**
 * Cancels a demo Job that has not ended, or returns undefined when it has (the
 * Gateway answers 409 YIR_JOB_NOT_CANCELLABLE). Demo Jobs keep no state: later
 * reads follow the original timeline, so keep the Job this returns.
 */
export function cancelDemoJob(id: string, now = Date.now()): Job | undefined {
  const fields = decode(id);
  const seconds = Math.floor(now / 1000);
  const status = statusAt(fields, seconds);
  return status === "queued" || status === "running" ? demoJob(fields, now, seconds) : undefined;
}
