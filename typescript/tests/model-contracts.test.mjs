import assert from "node:assert/strict";
import test from "node:test";

import {
  getModelContract,
  getModelOperationContract,
  listModelContracts,
} from "../dist/index.js";

test("SDK bundles multilingual static contracts for published image and video models", () => {
	const contracts = listModelContracts();
	const ids = contracts.map(({ id }) => id);
	assert.ok(contracts.length > 0);
	assert.equal(new Set(ids).size, ids.length);

  const image = getModelOperationContract("gpt-image-2", "generate_image", "text");
  assert.ok(image);
  const quality = image.parameters.find(({ name }) => name === "quality");
  assert.deepEqual(quality?.values, ["auto", "low", "medium", "high"]);
  assert.equal(quality.required, false);
  assert.equal(quality.default, undefined);
	assert.deepEqual(
		image.parameters.find(({ name }) => name === "resolution")?.values,
		["1K", "2K", "4K"],
	);
	assert.deepEqual(
		image.parameters.find(({ name }) => name === "n")?.values,
		[1],
	);
  assert.equal(
    image.parameters.find(({ name }) => name === "aspect_ratio")?.locales["zh-CN"].label,
    "画幅",
  );

  const wanImagePro = getModelOperationContract(
    "wan2.7-image-pro",
    "generate_image",
    "text",
  );
  assert.ok(wanImagePro);
  assert.deepEqual(
    wanImagePro.parameters.find(({ name }) => name === "resolution")?.values,
    ["1K", "2K", "4K"],
  );
  assert.equal(
    wanImagePro.parameters.find(({ name }) => name === "resolution")?.default,
    "2K",
  );

  const zImageTurbo = getModelOperationContract(
    "z-image-turbo",
    "generate_image",
    "text",
  );
  assert.ok(zImageTurbo);
  assert.deepEqual(
    zImageTurbo.parameters.find(({ name }) => name === "resolution")?.values,
    ["1K", "2K"],
  );
  assert.deepEqual(
    zImageTurbo.parameters.find(({ name }) => name === "aspect_ratio")?.values,
    ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"],
  );
  assert.deepEqual(
    zImageTurbo.parameters.find(({ name }) => name === "n")?.values,
    [1],
  );

  const fluxKontextEdit = getModelOperationContract(
    "flux-kontext-pro",
    "generate_image",
    "image",
  );
  assert.ok(fluxKontextEdit);
  assert.equal(fluxKontextEdit.input_constraints.image.max_references, 4);
  assert.deepEqual(
    fluxKontextEdit.parameters.find(({ name }) => name === "aspect_ratio")?.values,
    ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21"],
  );

  const video = getModelOperationContract("bytedance/seedance-2.0", "generate_video", "image");
  assert.ok(video);
  const duration = video.parameters.find(({ name }) => name === "duration");
  assert.equal(duration?.default, 4);
  assert.equal(duration?.minimum, 4);
  assert.equal(duration?.maximum, 15);
  assert.deepEqual(
    video.parameters.find(({ name }) => name === "resolution")?.values,
    ["480p", "720p", "1080p"],
  );
  assert.deepEqual(
    video.parameters.find(({ name }) => name === "generate_audio")?.values,
    [false, true],
  );
  assert.equal(video.input_constraints.image.min_references, 1);
  assert.deepEqual(video.input_constraints.image.allowed_reference_roles, [
    "first_frame",
    "last_frame",
  ]);

  const kling = getModelOperationContract("kling-v2-6", "generate_video", "text");
  assert.deepEqual(
    kling?.parameters.find(({ name }) => name === "duration")?.values,
    [5, 10],
  );

  const hailuo = getModelOperationContract(
    "minimax-hailuo-2.3",
    "generate_video",
    "text",
  );
  assert.deepEqual(
    hailuo?.parameters.find(({ name }) => name === "duration")?.values,
    [6, 10],
  );
  assert.deepEqual(
    hailuo?.parameters.find(({ name }) => name === "resolution")?.values,
    ["768P", "1080p"],
  );
  assert.equal(
    getModelOperationContract(
      "minimax-hailuo-2.3-fast",
      "generate_video",
      "text",
    ),
    undefined,
  );
  assert.ok(
    getModelOperationContract(
      "minimax-hailuo-2.3-fast",
      "generate_video",
      "image",
    ),
  );

  const wan = getModelOperationContract("wan2.7-r2v", "generate_video", "reference");
  assert.equal(
    wan?.input_constraints.reference.max_duration_by_reference_role?.reference_video,
    10,
  );
});

test("unknown models remain available to the generic request surface without a false contract", () => {
  assert.equal(getModelContract("future/model"), undefined);
  assert.equal(getModelOperationContract("future/model", "generate_image", "text"), undefined);
});

test("bundled model contracts are deeply immutable at runtime", () => {
  const contract = getModelContract("openai/gpt-image-2");
  assert.ok(contract);
  assert.throws(() => {
    contract.aliases[0] = "mutated";
  }, TypeError);
  assert.throws(() => {
    contract.operations[0].parameters[0].locales.en.label = "mutated";
  }, TypeError);
  assert.equal(getModelContract("gpt-image-2")?.id, "openai/gpt-image-2");
});
