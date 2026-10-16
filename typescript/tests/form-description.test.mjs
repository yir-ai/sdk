import assert from "node:assert/strict";
import test from "node:test";

import * as browser from "@yir-ai/sdk/browser";
import * as frontend from "@yir-ai/sdk/frontend";
import { defaultModelParameters, describeModelParameters, describeReferences } from "../dist/shared/catalog.js";
import { getModelOperationContract } from "./catalog-fixture.mjs";

test("frontend and browser expose the same form helpers", () => {
  for (const name of ["defaultModelParameters", "describeModelParameters", "describeReferences"]) {
    assert.equal(typeof frontend[name], "function", name);
    assert.equal(browser[name], frontend[name], name);
  }
});

test("defaults cover only parameters with a published default", () => {
  const operation = getModelOperationContract("gpt-image-2", "generate_image", "text");
  assert.deepEqual(defaultModelParameters(operation), { resolution: "1K", aspect_ratio: "auto", n: 1 });
});

test("fields keep contract options and prefer the caller's current value", () => {
  const operation = getModelOperationContract("gpt-image-2", "generate_image", "text");
  const current = { resolution: "4K", quality: "high" };
  const fields = describeModelParameters(operation, "text", current);
  assert.deepEqual(fields.map(({ name }) => name), operation.parameters.map(({ name }) => name));
  const resolution = fields.find(({ name }) => name === "resolution");
  assert.equal(resolution.value, "4K");
  assert.equal(resolution.default, "1K");
  assert.equal(resolution.control, "select");
  assert.deepEqual(resolution.options, [{ value: "1K" }, { value: "2K" }, { value: "4K" }]);
  assert.equal(resolution.type_known, true);
  assert.equal(fields.find(({ name }) => name === "aspect_ratio").value, "auto");
  const quality = fields.find(({ name }) => name === "quality");
  assert.equal(quality.value, "high");
  assert.equal("default" in quality, false);
  assert.deepEqual(current, { resolution: "4K", quality: "high" });
  assert.equal("value" in describeModelParameters(operation, "text").find(({ name }) => name === "quality"), false);
});

test("a reference role caps duration only while that role is present", () => {
  const operation = getModelOperationContract("alibaba/wan-2.7", "generate_video", "reference");
  const duration = roles => describeModelParameters(operation, "reference", {}, roles).find(({ name }) => name === "duration");
  assert.equal(duration(["reference_image"]).maximum, 15);
  assert.equal("maximum_reason" in duration(["reference_image"]), false);
  assert.equal(duration(["reference_image", "reference_video"]).maximum, 10);
  assert.equal(duration(["reference_video"]).maximum_reason, "reference_duration_limit");
  assert.equal(duration(["reference_video"]).minimum, 2);
  assert.equal(describeModelParameters(operation, "text", {}, ["reference_video"]).find(({ name }) => name === "duration").maximum, 15);
});

test("discrete duration options above the reference limit are disabled, not removed", () => {
  const operation = {
    operation: "generate_video", input_modes: ["reference"], request_schema: "fixture",
    input_constraints: { reference: { min_references: 1, max_references: 1, allowed_reference_roles: ["reference_video"], max_duration_by_reference_role: { reference_video: 10 } } },
    parameters: [{ name: "duration", type: "integer", required: false, values: [5, 10, 15], default: 5, minimum: 5, maximum: 15, control: "select", locales: { en: { label: "Duration", description: "" } } }],
  };
  const [field] = describeModelParameters(operation, "reference", { duration: 15 }, ["reference_video"]);
  assert.deepEqual(field.options, [{ value: 5 }, { value: 10 }, { value: 15, disabled: "reference_duration_limit" }]);
  assert.equal(field.value, 15);
  assert.equal(field.maximum, 10);
});

test("unknown parameter types are described for a generic input", () => {
  const operation = {
    operation: "generate_image", input_modes: ["text"], request_schema: "fixture",
    input_constraints: { text: { min_references: 0, max_references: 0, allowed_reference_roles: [] } },
    parameters: [{ name: "palette", type: "color", required: false, control: "color", locales: { en: { label: "Palette", description: "" } } }],
  };
  assert.deepEqual(describeModelParameters(operation, "text"), [
    { name: "palette", type: "color", control: "color", required: false, locales: { en: { label: "Palette", description: "" } }, type_known: false },
  ]);
});

test("reference slots combine role and total limits", () => {
  const image = getModelOperationContract("gpt-image-2", "generate_image", "image");
  assert.deepEqual(describeReferences(image.input_constraints.image, ["reference_image"]), {
    minimum: 1, maximum: 16, count: 1, remaining: 15, prompt_optional: false,
    roles: [{ role: "reference_image", minimum: 0, maximum: 16, count: 1, remaining: 15, required: false }],
  });

  const frames = getModelOperationContract("alibaba/wan-3.0", "generate_video", "image").input_constraints.image;
  const slots = describeReferences(frames, ["first_frame"]);
  assert.deepEqual(slots.roles, [
    { role: "first_frame", minimum: 1, maximum: 1, count: 1, remaining: 0, required: true },
    { role: "last_frame", minimum: 0, maximum: 1, count: 0, remaining: 1, required: false },
  ]);
  assert.equal(describeReferences(frames, ["first_frame", "last_frame"]).roles[1].remaining, 0);

  const seedance = getModelOperationContract("bytedance/seedance-2.5", "generate_video", "reference").input_constraints.reference;
  const mixed = describeReferences(seedance);
  // Seedance 2.5 accepts audio-only references (up to 10 clips) since 2026-10-16.
  assert.equal(mixed.required_any, undefined);
  assert.equal(mixed.roles.find(({ role }) => role === "reference_audio").maximum, 10);
  assert.equal(mixed.roles.find(({ role }) => role === "reference_video").maximum, 10);

  const kling = getModelOperationContract("klingai/kling-3.0", "generate_video", "reference").input_constraints.reference;
  assert.deepEqual(describeReferences(kling).roles.map(({ required }) => required), [true, true]);
  assert.equal("required_any" in describeReferences(kling), false);
});
