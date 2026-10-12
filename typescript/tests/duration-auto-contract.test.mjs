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


test("external duration contracts accept declared auto defaults without losing numeric constraints", async () => {
  const { parseModelContractCatalog } = await import("../dist/shared/catalog.js");
  const { validateModelParameters: validate } = await import("../dist/shared/standard.js");
  const { catalog } = await import("./catalog-fixture.mjs");
  const source = structuredClone(catalog);
  const model = source.models.find(model => model.id === "bytedance/seedance-2.5");
  const rule = model.operations.find(op => op.input_modes.includes("reference")).parameters.find(p => p.name === "duration");
  rule.default = "auto";
  rule.values = [4, 8];
  const parsed = parseModelContractCatalog(source);
  for (const duration of ["auto", 4, 8]) validate(model.id, "generate_video", "reference", { duration }, parsed);
  validate(model.id, "generate_video", "reference", {}, parsed);
  for (const duration of ["aut", "4", 0, 5, 99, false]) {
    assert.throws(() => validate(model.id, "generate_video", "reference", { duration }, parsed), YirSDKValidationError);
  }
  assert.equal(rule.default, "auto");
  rule.default = "adaptive";
  assert.throws(() => parseModelContractCatalog(source), /model_contract_invalid/);
});

test("external string_values must be a string array before parameter validation", async () => {
  const { parseModelContractCatalog } = await import("../dist/shared/catalog.js");
  const { catalog } = await import("./catalog-fixture.mjs");
  for (const stringValues of ["auto", 1, null, {}, [1], [null], [""]]) {
    const source = structuredClone(catalog);
    const rule = source.models.find(model => model.id === "bytedance/seedance-2.5")
      .operations.find(op => op.input_modes.includes("reference")).parameters.find(p => p.name === "duration");
    rule.string_values = stringValues;
    assert.throws(() => parseModelContractCatalog(source), /model_contract_invalid/);
  }
});
