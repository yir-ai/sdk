import type { Job, StandardImageGenerationRequest, StandardMediaSource, StandardVideoGenerationRequest } from "../../src/index.js";

const source: StandardMediaSource = { file_id: "file_11111111-1111-4111-8111-111111111111" };
const image: StandardImageGenerationRequest = {
  model: "openai/gpt-image-2", input: { type: "image", prompt: "Edit the image", references: [{ role: "reference_image", ...source }] },
  parameters: { resolution: "1K", aspect_ratio: "1:1", n: 1 },
};
const video: StandardVideoGenerationRequest = {
  model: "bytedance/seedance-2.0", input: image.input,
  parameters: { duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: false, n: 1 },
};
const urlSource: StandardMediaSource = { url: "https://example.com/image.png" };
// @ts-expect-error Sources must select exactly one transport representation.
const ambiguousSource: StandardMediaSource = { ...urlSource, file_id: "file_11111111-1111-4111-8111-111111111111" };
// @ts-expect-error A source cannot be empty.
const emptySource: StandardMediaSource = {};

function readJob(job: Job) {
  const count: number | undefined = job.usage?.outputs;
  const effect: "stop_future_attempts" | undefined = job.cancellation?.effect;
  const charges = job.billing?.compute_charges.map(charge => ({ amount: charge.amount, status: charge.status }));
  return { count, effect, charges, fee: job.billing?.gateway_fee.amount };
}

void [video, ambiguousSource, emptySource, readJob];
