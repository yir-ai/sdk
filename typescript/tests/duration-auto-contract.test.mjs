import assert from "node:assert/strict";
import test from "node:test";

import { YirSDKValidationError } from "../dist/shared/standard.js";
import { getModelOperationContract, validateModelParameters } from "./catalog-fixture.mjs";

test("Seedance 2.5 reference video accepts duration auto; text does not", () => {
  const model = "bytedance/seedance-2.5";
  const reference = getModelOperationContract(model, "generate_video", "reference");
  assert.deepEqual(reference.parameters.find(p => p.name === "duration").string_values, ["auto"]);
  validateModelParameters(model, "generate_video", "reference", { duration: "auto", aspect_ratio: "auto" });
  const rejected = error => error instanceof YirSDKValidationError && error.code === "parameter_type";
  assert.throws(() => validateModelParameters(model, "generate_video", "text", { duration: "auto" }), rejected);
  assert.throws(() => validateModelParameters(model, "generate_video", "reference", { duration: "adaptive" }), rejected);
});
