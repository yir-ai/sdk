import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createYirClient, buildPriceInput } from "@yir-ai/sdk";
import { calculatePrice } from "@yir-ai/sdk/pricing";
import {preparePricedRequest,previewCost} from './price-preview.mjs';
import {publishRetailTable,priceOrder} from './retail-table.mjs';
import { getModelContract } from "@yir-ai/sdk/model-contracts";
import { createYirAIProvider } from "@yir-ai/sdk/vercel";
import { validateModelParameters, getModelOperationContract } from "@yir-ai/sdk/browser";

validateModelParameters("google/nano-banana-2", "generate_image", "text", { web_search: true, image_search: true });
validateModelParameters("bytedance/seedance-2.0", "generate_video", "text", { return_last_frame: true });
assert.throws(() => validateModelParameters("google/nano-banana-2", "generate_image", "text", { return_last_frame: false }), { code: "parameter_unknown" });
for (const mode of ["text", "image"]) {
  validateModelParameters("google/nano-banana-pro", "generate_image", mode, { web_search: true });
  assert.throws(() => validateModelParameters("google/nano-banana-pro", "generate_image", mode, { image_search: false }), { code: "parameter_unknown" });
}
assert.throws(() => validateModelParameters("google/nano-banana-2", "generate_image", "text", { image_search: true }), { code: "parameter_dependency" });
assert.equal(getModelOperationContract("bytedance/seedance-2", "generate_video", "reference").input_constraints.reference.reference_counts_by_role.reference_image.maximum, 9);

const consumer = path.dirname(fileURLToPath(import.meta.url));
for (const name of ["@yir-ai/sdk", "@yir-ai/sdk/model-contracts", "@yir-ai/sdk/vercel", "@yir-ai/sdk/pricing", "@yir-ai/sdk/server", "@yir-ai/sdk/browser", "@yir-ai/sdk/shared"]) {
  const resolved = fileURLToPath(import.meta.resolve(name));
  assert.ok(resolved.startsWith(path.join(consumer, "node_modules") + path.sep), "Entry must resolve from the installed archive");
  assert.ok(resolved.endsWith(".js"));
}
const request = { model: "openai/gpt-image-2", input: { type: "text", prompt: "test" }, parameters: {} };
let calls = 0;
const client = createYirClient(async () => {
  calls++;
  return { object: "quote", model: request.model, operation: "generate_image", input_mode: "text", parameters: {}, currency: "USD",
    primary: { kind: "fixed", amount: "0.02" }, max: { kind: "fixed", amount: "0.05" },
    official: { kind: "estimate", amount: "0.04239", estimate: { scope: "output_only", output_tokens: 1413 } },
    supply: { available: true, issues: [] }, has_verifiable_upper_bound: true, single_attempt_upper_bound: "0.05", expires_at: 1900000000 };
});
assert.equal((await client.quoteImage(request)).official.estimate.scope, "output_only");
assert.throws(() => client.quoteImage({ ...request, parameters: { unknown_parameter: true } }), { code: "parameter_unknown" });
assert.equal(calls, 1, "Invalid parameters must fail inside the installed SDK before transport");
assert.equal(getModelContract(request.model).id, request.model);
assert.equal(createYirAIProvider({ client }).imageModel(request.model).specificationVersion, "v4");

const video=preparePricedRequest('generate_video',{model:'klingai/kling-2.6',input:{type:'text',prompt:'test'},parameters:{}});
const priceInput=buildPriceInput('generate_video',video,'cost-v1');
const conditions=Object.fromEntries(Object.entries(priceInput.parameters).map(([key,value])=>[key,[value]]));
const cost={format:'yir-price-table-v1',version:'cost-v1',purpose:'yir-cost',unit:'USD',scale:1000000,rows:[
  {id:'five',model:video.model,operation:'generate_video',conditions,kind:'exact',price:{type:'total',amount:'184000'}},
  {id:'ten',model:video.model,operation:'generate_video',conditions:{...conditions,duration:[10]},kind:'exact',price:{type:'total',amount:'368000'}},
]};
const modelPrices={id:video.model,object:'model_prices',operation:'generate_video',input_mode:'text',contract_version:'fixture-v1',coverage:'enumerated',issues:[],filter:{resolution:'720p'},prices:{primary:cost,max:cost,expires_at:100,unavailable:[]}};
let priceReads=0;
const pricesClient=createYirClient(async request=>{
  priceReads++;
  assert.equal(request.path,'/v1/models/klingai/kling-2.6?view=pricing&operation=generate_video&input_mode=text&resolution=720p');
  return structuredClone(modelPrices);
});
const loaded=await pricesClient.getModelPrices(video.model,'generate_video','text',{filter:{resolution:'720p'}});
const retail=publishRetailTable(loaded.prices.primary,'retail-v1');
const trusted=new Map([[retail.version,retail]]);
for(const duration of [5,10,5]) {
  const prepared={...video,parameters:{...video.parameters,duration}};
  const preview=previewCost(loaded,'generate_video',prepared,99);
  assert.equal(preview.state,'exact');
  const input=buildPriceInput('generate_video',preview.request,retail.version);
  assert.deepEqual(priceOrder(trusted,input),calculatePrice(retail,input));
  assert.equal(priceOrder(trusted,input).amount,duration===5?'23':'46');
}
assert.equal(priceReads,1);
assert.equal(previewCost(undefined,'generate_video',video,99).state,'load_required');
assert.equal(previewCost(loaded,'generate_video',video,100).state,'refresh_required');
assert.throws(()=>priceOrder(trusted,{...priceInput,version:'expired'}),/price_version_expired/);

const browser = await import('@yir-ai/sdk/browser');
const shared = await import('@yir-ai/sdk/shared');
const server = await import('@yir-ai/sdk/server');
assert.equal(browser.calculatePrice, calculatePrice);
assert.equal(shared.getModelContract, getModelContract);
assert.equal(server.createYirClient, createYirClient);
assert.equal('createNodeYirClient' in browser, false);
