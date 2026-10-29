#!/usr/bin/env node
// Builds the DEMO-badged sample files that SDK demo mode returns, and the
// tables that point at them. No generation model is called: images and videos
// are cropped from existing samples, music and sound effects are synthesized
// with ffmpeg, and speech uses the local Windows speech engine (or --speech).
//
//   node spec/scripts/build-demo-assets.mjs --source <dir with .jpg/.mp4> --out <dir>
//   node spec/scripts/build-demo-assets.mjs --tables   # regenerate SDK tables from spec/demo-assets.json
//
// Upload <out>/demo/v1/** to the yir-weur bucket under public/demo/v1/ so it is
// served at https://public.yir.ai/demo/v1/. Keys are immutable: change v1 when content changes.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(root, "spec/demo-assets.json");
export const DEMO_ASSET_BASE_URL = "https://public.yir.ai/demo/v1/";

const IMAGE_SIZES = {
  "1:1": [1024, 1024], "16:9": [1280, 720], "9:16": [720, 1280], "4:3": [1152, 864],
  "3:4": [864, 1152], "3:2": [1200, 800], "2:3": [800, 1200], "21:9": [1344, 576],
};
const IMAGE_VARIANTS = 4;
const VIDEO_SIZES = {
  "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [720, 720],
  "4:3": [960, 720], "3:4": [720, 960], "21:9": [1680, 720],
};
const VIDEO_DURATIONS = [5, 10];
const SPEECH_TEXT = "This is a Yir demo result. No credits were used.";

function args() {
  const result = {};
  const list = process.argv.slice(2);
  for (let i = 0; i < list.length; i++) {
    const name = list[i].replace(/^--/, "");
    result[name] = list[i + 1] && !list[i + 1].startsWith("--") ? list[++i] : true;
  }
  return result;
}

const run = (command, list) => execFileSync(command, list, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const ffmpeg = list => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...list]);
const slug = aspect => aspect.replace(":", "x");

function defaultFont() {
  for (const candidate of ["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("font not found; pass --font <ttf>");
}

// Corner badge plus a large translucent watermark, sized to the frame.
function badge(font, width, height) {
  const file = font.replace(/\\/g, "/").replace(/:/g, "\\:");
  const short = Math.min(width, height);
  const corner = Math.round(short * 0.07);
  const pad = Math.round(corner * 0.35);
  return [
    `drawtext=fontfile='${file}':text='DEMO':fontsize=${Math.round(short * 0.16)}:fontcolor=white@0.30:borderw=2:bordercolor=black@0.15:x=(w-text_w)/2:y=(h-text_h)/2`,
    `drawtext=fontfile='${file}':text='DEMO':fontsize=${corner}:fontcolor=white:box=1:boxcolor=0xE5484D@0.92:boxborderw=${pad}:x=${pad * 2}:y=${pad * 2}`,
  ].join(",");
}

const fill = (width, height) => `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;

function probe(file) {
  const out = JSON.parse(run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file]));
  const video = out.streams.find(stream => stream.codec_type === "video");
  return { width: video?.width, height: video?.height, duration: Number(out.format?.duration) };
}

const sha256 = file => createHash("sha256").update(readFileSync(file)).digest("hex");

function build(options) {
  const source = resolve(options.source);
  const out = join(resolve(options.out), "demo/v1");
  const font = options.font ?? defaultFont();
  const files = readdirSync(source).sort();
  const images = files.filter(name => name.endsWith(".jpg")).map(name => join(source, name));
  const videos = files.filter(name => name.endsWith(".mp4")).map(name => join(source, name));
  if (images.length < IMAGE_VARIANTS || videos.length < 1) throw new Error("source needs at least 4 .jpg and 1 .mp4 files");
  for (const dir of ["image", "video", "audio"]) mkdirSync(join(out, dir), { recursive: true });
  const assets = [];
  const record = (entry, file) => assets.push({ ...entry, sha256: sha256(file) });

  let next = 0;
  for (const [aspect, [width, height]] of Object.entries(IMAGE_SIZES)) {
    for (let variant = 1; variant <= IMAGE_VARIANTS; variant++) {
      const path = `image/${slug(aspect)}-${variant}.jpg`;
      const file = join(out, path);
      ffmpeg(["-i", images[next++ % images.length], "-vf", `${fill(width, height)},${badge(font, width, height)}`, "-frames:v", "1", "-q:v", "3", file]);
      const { width: w, height: h } = probe(file);
      record({ kind: "image", aspect_ratio: aspect, variant, path, media_type: "image/jpeg", width: w, height: h }, file);
    }
  }
  let clip = 0;
  for (const [aspect, [width, height]] of Object.entries(VIDEO_SIZES)) {
    const input = videos[clip++ % videos.length];
    for (const duration of VIDEO_DURATIONS) {
      const path = `video/${slug(aspect)}-${duration}s.mp4`;
      const file = join(out, path);
      ffmpeg(["-stream_loop", "-1", "-i", input, "-t", String(duration), "-vf", `${fill(width, height)},${badge(font, width, height)},fps=24`,
        "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file]);
      const { width: w, height: h, duration: seconds } = probe(file);
      record({ kind: "video", aspect_ratio: aspect, duration, path, media_type: "video/mp4", width: w, height: h, duration_ms: Math.round(seconds * 1000) }, file);
    }
  }

  const audio = (kind, path, list) => {
    const file = join(out, path);
    ffmpeg([...list, "-ac", "1", "-c:a", "libmp3lame", "-b:a", "96k", file]);
    record({ kind, path, media_type: "audio/mpeg", duration_ms: Math.round(probe(file).duration * 1000) }, file);
  };
  // A C-major arpeggio (0, 4, 7, 12 semitones) with a per-note decay.
  audio("music", "audio/music.mp3", ["-f", "lavfi", "-i",
    "aevalsrc='0.25*sin(2*PI*t*261.63*pow(2,(4*mod(floor(t*2),4)-eq(mod(floor(t*2),4),2))/12))*exp(-3*mod(t,0.5))':s=44100:d=30"]);
  audio("sound_effect", "audio/sound-effect.mp3", ["-f", "lavfi", "-i", "anoisesrc=d=5:c=pink:a=0.5",
    "-af", "afade=t=in:d=1.5,afade=t=out:st=2.5:d=2.5,lowpass=f=3000"]);
  const speechInput = options.speech ? resolve(options.speech) : join(out, "audio/speech.wav");
  if (!options.speech) {
    run("powershell", ["-NoProfile", "-Command",
      `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${speechInput}'); $s.Speak('${SPEECH_TEXT}'); $s.Dispose()`]);
  }
  audio("speech", "audio/speech.mp3", ["-i", speechInput]);
  if (!options.speech) execFileSync(process.platform === "win32" ? "cmd" : "rm", process.platform === "win32" ? ["/c", "del", speechInput.replace(/\//g, "\\")] : [speechInput]);

  writeFileSync(manifestPath, `${JSON.stringify({ base_url: DEMO_ASSET_BASE_URL, assets }, null, 2)}\n`);
}

// The SDK tables carry everything but the hashes, which only matter for upload checks.
function tables() {
  const { base_url, assets } = JSON.parse(readFileSync(manifestPath, "utf8"));
  const rows = assets.map(({ sha256: _, ...entry }) => entry);
  const header = "// Code generated by spec/scripts/build-demo-assets.mjs; DO NOT EDIT.";
  writeFileSync(join(root, "typescript/src/shared/demo-assets.ts"), `${header}

/** Fixed DEMO-badged files that demo-mode Jobs return. */
export const DEMO_ASSET_BASE_URL = ${JSON.stringify(base_url)};

export type DemoAsset = {
  readonly kind: "image" | "video" | "music" | "sound_effect" | "speech";
  readonly aspect_ratio?: string;
  readonly variant?: number;
  readonly duration?: number;
  readonly path: string;
  readonly media_type: string;
  readonly width?: number;
  readonly height?: number;
  readonly duration_ms?: number;
};

export const DEMO_ASSETS: readonly DemoAsset[] = Object.freeze([
${rows.map(row => `  ${JSON.stringify(row)},`).join("\n")}
]);
`);
  const go = row => `\t{Kind: ${JSON.stringify(row.kind)}, AspectRatio: ${JSON.stringify(row.aspect_ratio ?? "")}, Variant: ${row.variant ?? 0}, Duration: ${row.duration ?? 0}, ` +
    `Path: ${JSON.stringify(row.path)}, MediaType: ${JSON.stringify(row.media_type)}, Width: ${row.width ?? 0}, Height: ${row.height ?? 0}, DurationMS: ${row.duration_ms ?? 0}},`;
  writeFileSync(join(root, "go/demo_assets.go"), `${header}

package yir

// DemoAssetBaseURL hosts the fixed DEMO-badged files that demo-mode Jobs return.
const DemoAssetBaseURL = ${JSON.stringify(base_url)}

type demoAsset struct {
\tKind        string
\tAspectRatio string
\tVariant     int
\tDuration    int
\tPath        string
\tMediaType   string
\tWidth       int
\tHeight      int
\tDurationMS  int64
}

var demoAssets = []demoAsset{
${rows.map(go).join("\n")}
}
`);
}

const options = args();
if (!options.tables) {
  if (!options.source || !options.out) throw new Error("usage: --source <dir> --out <dir> | --tables");
  build(options);
}
tables();
