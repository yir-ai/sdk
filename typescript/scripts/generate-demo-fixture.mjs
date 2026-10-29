// Regenerates the demo Job vectors shared by the TypeScript and Go tests from
// the built SDK. Run `pnpm build` first; IDs change on every run (random nonce).
import { writeFileSync } from "node:fs";
import { createDemoJob, getDemoJob, getDemoJobStatus } from "../dist/index.js";

const created = 1793000000000;
const quote = (model, operation, parameters) => ({ model, operation, parameters });
const specs = [
  [quote("openai/gpt-image-2", "generate_image", { n: 2, aspect_ratio: "16:9", resolution: "2K", quality: "high" }), "ok", [1, 5, 8]],
  [quote("google/gemini-3.1-flash-lite-image", "generate_image", { n: 6, aspect_ratio: "4:5", resolution: "1K" }), "ok", [9]],
  [quote("spacexai/grok-imagine-video-1.5-lite", "generate_video", { n: 1, aspect_ratio: "9:16", resolution: "720p", duration: 8 }), "ok", [2, 10, 25]],
  [quote("bytedance/seedance-2.0", "generate_video", { n: 1, aspect_ratio: "adaptive", resolution: "1080p", duration: "auto" }), "fail", [24, 25]],
  [quote("klingai/kling-4.0", "generate_video", { n: 1, aspect_ratio: "21:9", duration: 15 }), "cancel", [30]],
  [quote("minimax/music-2.6", "generate_music", { n: 2, instrumental: false }), "slow", [359, 360, 480]],
  [quote("elevenlabs/sound-effects-v2", "generate_sound_effect", { n: 1, duration: 5 }), "ok", [12]],
  [quote("minimax/speech-2.8-hd", "generate_speech", { n: 1, voice: "English_Graceful_Lady" }), "ok", [12]],
];
const cases = [];
for (const [item, scenario, offsets] of specs) {
  const { id } = createDemoJob(item, scenario, created);
  for (const offset of offsets) {
    const now = created + offset * 1000;
    cases.push({ id, now_ms: now, job: getDemoJob(id, now), status: getDemoJobStatus(id, now) });
  }
}
const text = `${JSON.stringify({ cases }, null, 2)}\n`;
for (const path of ["../../spec/fixtures/demo-jobs.json", "../../go/testdata/demo-jobs.json"]) {
  writeFileSync(new URL(path, import.meta.url), text);
}
