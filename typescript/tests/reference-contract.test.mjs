import { validateGeneration } from "./catalog-fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { getModelOperationContract } from "./catalog-fixture.mjs";

const fileID = (role, i) => `file_12345678-1234-4123-8123-${String(i).padStart(12, "0")}`;
const ref = (role, i = 0) => ({ role, file_id: fileID(role, i) });

test("H3 accepts official reference combinations without changing file_id or order", () => {
  for (const [images, videos, audios, valid] of [[1, 0, 0, true], [9, 0, 0, true], [0, 3, 0, true], [0, 0, 3, true], [9, 3, 3, true], [10, 0, 0, false], [1, 4, 0, false], [1, 0, 4, false], [0, 0, 0, false]]) {
    let counter = 0;
    const references = [["reference_audio", audios], ["reference_image", images], ["reference_video", videos]].flatMap(([role, count]) => Array.from({ length: count }, () => ({ role, file_id: fileID(role, counter++) })));
    const before = structuredClone(references);
    const check = () => validateGeneration("generate_video", { model: "minimax/minimax-h3", input: { type: "reference", prompt: "fixture", references }, parameters: {} });
    if (valid) assert.doesNotThrow(check); else assert.throws(check);
    assert.deepEqual(references, before);
  }
});

test("reference role counts and alternatives are exported and enforced", () => {
  const contract = getModelOperationContract("bytedance/seedance-2.0", "generate_video", "reference");
  assert.equal(contract.input_constraints.reference.reference_counts_by_role.reference_image.maximum, 9);
  for (const [images, videos, audios, valid] of [[9, 3, 3, true], [10, 0, 0, false], [1, 4, 0, false], [1, 0, 4, false], [0, 0, 1, false]]) {
    const references = [
      ...Array.from({ length: images }, (_, i) => ({ ...ref("reference_image", i) })),
      ...Array.from({ length: videos }, (_, i) => ({ ...ref("reference_video", 100 + i) })),
      ...Array.from({ length: audios }, (_, i) => ({ ...ref("reference_audio", 200 + i) })),
    ];
    const check = () => validateGeneration("generate_video", { model: "bytedance/seedance-2.0", input: { type: "reference", prompt: "fixture", references }, parameters: {} });
    if (valid) assert.doesNotThrow(check); else assert.throws(check);
  }
});

test("reference role duration is output duration and applies only to the matching role", () => {
  for (const [role, duration, valid] of [["reference_video", 10, true], ["reference_video", 11, false], ["reference_image", 11, true]]) {
    const check = () => validateGeneration("generate_video", { model: "alibaba/wan-2.7", input: { type: "reference", prompt: "fixture", references: [ref(role)] }, parameters: { duration } });
    if (valid) assert.doesNotThrow(check); else assert.throws(check, error => error.code === "reference_duration_limit");
  }
});

test("duplicate references fail before transport", () => {
  assert.throws(() => validateGeneration("generate_video", { model: "bytedance/seedance-2.0", input: { type: "reference", prompt: "fixture", references: [ref("reference_image"), ref("reference_image")] }, parameters: {} }), error => error.code === "duplicate_reference");
});


test("Kling 3.0 subject photos use the declared subject limits and parameter values", () => {
  const photo = (subject, i) => ({ role: "reference_image", url: `https://example.com/${subject}-${i}.png`, subject });
  const request = (parameters, ...references) => ({ model: "klingai/kling-3.0", input: { type: "reference", prompt: "@hero meets @friend", references }, parameters });
  const contract = getModelOperationContract("klingai/kling-3.0", "generate_video", "reference");
  assert.equal(contract.input_constraints.reference.subject_references.max_subjects, 3);
  assert.doesNotThrow(() => validateGeneration("generate_video", request({ resolution: "1080p", aspect_ratio: "9:16", duration: 10, generate_audio: true },
    photo("hero", 1), photo("hero", 2), photo("friend", 1), photo("friend", 2), photo("friend", 3))));
  assert.doesNotThrow(() => validateGeneration("generate_video", request({}, photo("hero", 1), photo("hero", 2))));
  for (const [name, body] of Object.entries({
    onePhoto: request({}, photo("hero", 1)),
    fivePhotos: request({}, ...[1, 2, 3, 4, 5].map(i => photo("a", i))),
    fourSubjects: request({}, ..."abcd".split("").flatMap(s => [photo(s, 1), photo(s, 2)])),
    motionAspect: request({ aspect_ratio: "auto" }, photo("hero", 1), photo("hero", 2)),
    twentySeconds: request({ duration: 20 }, photo("hero", 1), photo("hero", 2)),
    invalidName: request({}, photo("1hero", 1), photo("1hero", 2)),
    mixed: request({}, photo("hero", 1), photo("hero", 2), { role: "reference_image", url: "https://example.com/x.png" }),
    otherModel: { model: "bytedance/seedance-2.0", input: { type: "reference", prompt: "x", references: [photo("hero", 1), photo("hero", 2)] }, parameters: {} },
  })) {
    assert.throws(() => validateGeneration("generate_video", body), undefined, name);
  }
  // Motion control is unchanged: one image plus one video at auto aspect ratio.
  assert.doesNotThrow(() => validateGeneration("generate_video", request({}, ref("reference_image", 1), ref("reference_video", 2))));
});

test("Kling 4.0 mixes subjects, voices and ungrouped reference images", () => {
  const photo = (subject, i) => ({ role: "reference_image", url: `https://example.com/${subject}-${i}.png`, ...(subject ? { subject } : {}) });
  const voice = subject => ({ role: "reference_audio", url: `https://example.com/${subject || "x"}.mp3`, ...(subject ? { subject } : {}) });
  const check = references => () => validateGeneration("generate_video", { model: "klingai/kling-4.0", input: { type: "reference", prompt: "@Hero holds @image_1", references }, parameters: {} });
  const plain = n => Array.from({ length: n }, (_, i) => photo("", i));
  assert.doesNotThrow(check([photo("Hero", 1), photo("", 1), photo("Hero", 2), voice("Hero"), voice("Narrator")]));
  assert.doesNotThrow(check([voice("Narrator")]));
  assert.doesNotThrow(check([...plain(10), photo("Hero", 1), photo("Hero", 2)]));
  for (const invalid of [
    plain(11),
    [photo("Hero", 1)],
    [voice("Hero"), voice("Hero")],
    [voice("A"), voice("B"), voice("C"), voice("D")],
    [photo("", 1), voice("")],
    [...plain(10), ...["A", "B", "C", "D", "E", "F"].flatMap(s => [photo(s, 1), photo(s, 2)])],
  ]) assert.throws(check(invalid));
  // Kling 3.0 subjects are not mixed and take photos only.
  assert.throws(() => validateGeneration("generate_video", { model: "klingai/kling-3.0", input: { type: "reference", prompt: "@hero", references: [photo("hero", 1), photo("hero", 2), voice("hero")] }, parameters: {} }));
});
