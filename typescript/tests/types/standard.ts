import type {
  Job,
  JobCancellation,
  JobResultFile,
  JobStatusResponse,
  Quote,
  QuoteParameters,
  StandardImageGenerationRequest,
  StandardMediaSource,
  StandardMusicGenerationRequest,
  StandardMusicQuoteRequest,
  StandardVideoGenerationRequest,
  YirClient,
  YirErrorCode,
} from "../../src/index.js";
import { YirTimeoutError } from "../../src/index.js";

const source: StandardMediaSource = { file_id: "file_11111111-1111-4111-8111-111111111111" };
const image: StandardImageGenerationRequest = {
  model: "openai/gpt-image-2", input: { type: "image", prompt: "Edit the image", references: [{ role: "reference_image", ...source }] },
  parameters: { resolution: "1K", aspect_ratio: "1:1", n: 1 },
};
const video: StandardVideoGenerationRequest = {
  model: "bytedance/seedance-2.0", input: image.input,
  parameters: { duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: false, n: 1 },
};
// An image echo carries no duration or generate_audio; a Job echoes the same shape.
const imageEcho: QuoteParameters = { resolution: "1K", aspect_ratio: "1:1", n: 1 };
const videoEcho: QuoteParameters = { duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: false, n: 1, return_last_frame: false };
const adaptiveEcho: QuoteParameters = { duration: "auto", resolution: "480p", aspect_ratio: "auto", n: 1 };
const adaptiveJobParameters: Job["parameters"] = adaptiveEcho;
void adaptiveJobParameters;
const echoedDuration: number | "auto" | undefined = videoEcho.duration;
void echoedDuration;
const jobParameters: Job["parameters"] = imageEcho;
void jobParameters;
// Music parameters are optional; a music echo has no resolution or aspect_ratio.
const music: StandardMusicGenerationRequest = {
  model: "minimax/music-2.6", input: { type: "text", prompt: "Lo-fi piano", lyrics: "[Verse]\nRain" },
  webhook_url: "https://example.com/webhooks/yir",
};
const musicQuote: StandardMusicQuoteRequest = { model: "music-2.6", input: { type: "text", prompt: "Lo-fi piano" }, parameters: { instrumental: true } };
// @ts-expect-error A quote request carries no webhook.
const musicQuoteWithWebhook: StandardMusicQuoteRequest = { model: "music-2.6", input: { type: "text", prompt: "Lo-fi piano" }, webhook_url: "https://example.com/webhooks/yir" };
const musicEcho: QuoteParameters = { instrumental: false, lyrics_optimizer: true, n: 1 };
// Length-priced models take duration; sound effects use the music request shape.
const soundEffect: StandardMusicQuoteRequest = { model: "elevenlabs/sound-effects-v2", input: { type: "text", prompt: "Glass shattering" }, parameters: { duration: 5 } };
const soundEcho: QuoteParameters = { n: 1, duration: 5 };
// Text-to-speech reads input.prompt aloud in a preset voice through the music request shape.
const speech: StandardMusicQuoteRequest = { model: "minimax/speech-2.8-hd", input: { type: "text", prompt: "Welcome to Yir." }, parameters: { voice: "English_expressive_narrator" } };
const speechEcho: QuoteParameters = { n: 1, voice: "English_expressive_narrator" };
function readDuration(file: JobResultFile): number | undefined {
  return file.duration_ms;
}
void [musicQuoteWithWebhook, musicEcho, soundEcho, speechEcho, readDuration];
// A source is a File ID or a public HTTPS URL, never both.
const urlSource: StandardMediaSource = { url: "https://example.com/image.png" };
// @ts-expect-error A source carries exactly one of file_id and url.
const bothSources: StandardMediaSource = { url: "https://example.com/image.png", file_id: "file_1" };

function submitWithOptionalKeys(client: YirClient) {
  void client.submitImage(image);
  void client.submitVideo(video);
  void client.submitImage(image, "persisted-key");
  void client.submitVideo(video, undefined, { signal: new AbortController().signal });
  void client.quoteMusic(musicQuote);
  void client.submitMusic(music, "persisted-key");
  void client.quoteBatch([{ operation: "generate_music", request: musicQuote }, { operation: "generate_sound_effect", request: soundEffect }, { operation: "generate_speech", request: speech }]);
}

void submitWithOptionalKeys;
// @ts-expect-error Sources must select exactly one transport representation.
const ambiguousSource: StandardMediaSource = { url: "https://example.com/image.png", file_id: "file_11111111-1111-4111-8111-111111111111" };
// @ts-expect-error A source cannot be empty.
const emptySource: StandardMediaSource = {};

function readJob(job: Job) {
  const count: number | undefined = job.usage?.outputs;
  const effect: "stop_future_attempts" | undefined = job.cancellation?.effect;
  const charges = job.billing?.compute_charges.map(charge => ({ amount: charge.amount, status: charge.status }));
  return { count, effect, charges, fee: job.billing?.gateway_fee.amount };
}

function readStatus(status: JobStatusResponse) {
  const id: string = status.id;
  const cancellation: JobCancellation | undefined = status.cancellation;
  return { id, status: status.status, cancellation };
}

function checkTimeout(err: YirTimeoutError) {
  const lastStatus: JobStatusResponse | undefined = err.lastStatus;
  return { jobId: err.jobId, lastStatus };
}

function readQuoteSearch(quote: Quote) {
  const flags: (boolean | undefined)[] = [quote.parameters.web_search, quote.parameters.image_search, quote.parameters.return_last_frame];
  return flags;
}

function cancelWithTimeout(client: YirClient) {
  return client.cancelJob("7001", { signal: AbortSignal.timeout(1000) });
}

const insufficientBalance: YirErrorCode = "YIR_INSUFFICIENT_BALANCE";
// @ts-expect-error unknown codes are not stable public error codes
const unknownCode: YirErrorCode = "YIR_NOT_A_CODE";

void [video, ambiguousSource, emptySource, readJob, readStatus, checkTimeout, readQuoteSearch, cancelWithTimeout, insufficientBalance, unknownCode];

async function readMarketDetailAndContent(client: YirClient) {
  const detail = await client.getModel("openai/gpt-image-2");
  const amount: number | undefined = detail.specifications[0]?.channels[0]?.amount_micros;
  const signedURL: string = await client.getFileContentURL("file_11111111-1111-4111-8111-111111111111");
  void amount;
  void signedURL;
}
void readMarketDetailAndContent;


import { createYirAIProvider, type YirAIImageModel } from "../../src/server/vercel.js";
import { generateImage, experimental_startVideo as startVideo } from "ai";
function checkAIProviderCompatibility(client: YirClient) {
  const provider = createYirAIProvider({ client });
  const image: YirAIImageModel = provider.image("openai/gpt-image-2");
  const supportsFiles: boolean | undefined = image.supportsFileInputs;
  const supportsMasks: false = image.supportsMaskInputs;
  void generateImage({ model: image, prompt: "Fixture", headers: { "Idempotency-Key": "saved-key" } });
  void startVideo({ model: provider.video("bytedance/seedance-2.0"), prompt: "Fixture" });
  void [supportsFiles, supportsMasks];
}
void checkAIProviderCompatibility;

import { defaultModelParameters, describeModelParameters, describeReferences, type ModelParameterField, type ReferenceSlots } from "../../src/browser/index.js";
import type { ModelOperationContract } from "../../src/index.js";
function describeForm(operation: ModelOperationContract) {
  const defaults: Record<string, string | number | boolean> = defaultModelParameters(operation);
  const fields: readonly ModelParameterField[] = describeModelParameters(operation, "image", defaults, ["reference_image"]);
  const disabled: "reference_duration_limit" | undefined = fields[0]?.options?.[0]?.disabled;
  const slots: ReferenceSlots | undefined = operation.input_constraints.image && describeReferences(operation.input_constraints.image);
  void [disabled, slots];
}
void describeForm;
