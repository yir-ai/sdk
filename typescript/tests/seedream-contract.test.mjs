import { validateGeneration } from "./catalog-fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";


test("Seedream 5.0 accepts 4K with up to 14 images without extending other parameters", () => {
  for (const mode of ["text", "image"]) {
    for (const resolution of ["2K", "3K", "4K"]) {
      for (const count of mode === "text" ? [0, 1] : [0, 1, 10, 11, 14, 15]) {
        const request = {
          model: "bytedance/seedream-5.0",
          input: { type: mode, prompt: "fixture", references: Array.from({ length: count }, (_, i) => ({ role: "reference_image", file_id: `file_11111111-1111-4111-8111-${String(i).padStart(12, "0")}` })) },
          parameters: { resolution },
        };
        const before = structuredClone(request);
        const check = () => validateGeneration("generate_image", request);
        if (mode === "text" ? count === 0 : count >= 1 && count <= 14) assert.doesNotThrow(check);
        else assert.throws(check);
        assert.deepEqual(request, before);
      }
    }
    for (const parameters of [{ resolution: "8K" }, { n: 2 }, { aspect_ratio: "5:1" }, { web_search: false }, { image_search: false }]) {
      assert.throws(() => validateGeneration("generate_image", {
        model: "bytedance/seedream-5.0",
        input: { type: mode, prompt: "fixture", references: mode === "image" ? [{ role: "reference_image", file_id: "file_11111111-1111-4111-8111-111111111111" }] : [] },
        parameters,
      }));
    }
  }
});
