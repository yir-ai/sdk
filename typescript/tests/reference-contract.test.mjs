import assert from "node:assert/strict";
import test from "node:test";
import { validateGeneration, getModelOperationContract } from "../dist/index.js";

const ref = role => ({ role, url: "https://example.com/fixture" });
test("reference role counts and alternatives are exported and enforced", () => {
  const contract = getModelOperationContract("bytedance/seedance-2", "generate_video", "reference");
  assert.equal(contract.input_constraints.reference.reference_counts_by_role.reference_image.maximum, 9);
  for (const [images, videos, audios, valid] of [[9, 3, 3, true], [10, 0, 0, false], [1, 4, 0, false], [1, 0, 4, false], [0, 0, 1, false]]) {
    const references = [
      ...Array.from({ length: images }, (_, i) => ({ ...ref("reference_image"), url: `https://example.com/image/${i}` })),
      ...Array.from({ length: videos }, (_, i) => ({ ...ref("reference_video"), url: `https://example.com/video/${i}` })),
      ...Array.from({ length: audios }, (_, i) => ({ ...ref("reference_audio"), url: `https://example.com/audio/${i}` })),
    ];
    const check = () => validateGeneration("generate_video", { model: "bytedance/seedance-2", input: { type: "reference", prompt: "fixture", references }, parameters: {} });
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
  assert.throws(() => validateGeneration("generate_video", { model: "bytedance/seedance-2", input: { type: "reference", prompt: "fixture", references: [ref("reference_image"), ref("reference_image")] }, parameters: {} }), error => error.code === "duplicate_reference");
});

test("H3 accepts official reference combinations without changing URLs or order", () => {
  const image = getModelOperationContract("minimax/minimax-h3", "generate_video", "image");
  assert.deepEqual(image.parameters.find(p => p.name === "aspect_ratio").values, ["adaptive"]);
  for (const [images, videos, audios, valid] of [[1, 0, 0, true], [9, 0, 0, true], [0, 3, 0, true], [0, 0, 3, true], [9, 3, 3, true], [10, 0, 0, false], [1, 4, 0, false], [1, 0, 4, false], [0, 0, 0, false]]) {
    const references = [["reference_audio", audios], ["reference_image", images], ["reference_video", videos]].flatMap(([role, count]) => Array.from({ length: count }, (_, i) => ({ role, url: `https://example.com/${role}/${i}` })));
    const before = structuredClone(references);
    const check = () => validateGeneration("generate_video", { model: "minimax/minimax-h3", input: { type: "reference", prompt: "fixture", references }, parameters: {} });
    if (valid) assert.doesNotThrow(check); else assert.throws(check);
    assert.deepEqual(references, before);
  }
});
