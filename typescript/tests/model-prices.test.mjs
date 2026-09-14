import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildPriceInput, calculatePrice, createYirClient} from "../dist/index.js";
import {validateModelPrices} from "../dist/shared/model-prices.js";
const fixtures = JSON.parse(readFileSync(new URL("../../go/testdata/model-price-input-v1.json", import.meta.url)));

test("filtered model prices preserve and validate the requested scope", async () => {
  const f=fixtures[1];
  const input=buildPriceInput(f.operation,f.request,"scope-v1");
  const filter={resolution:input.parameters.resolution,reference_count:2};
  const row={id:"scope",model:input.model,operation:f.operation,conditions:Object.fromEntries(Object.entries(input.parameters).map(([k,v])=>[k,[v]])),kind:"exact",price:{type:"total",amount:"1"}};
  const table={format:"yir-price-table-v1",version:"scope-v1",purpose:"yir-cost",unit:"USD",scale:1000000,rows:[row]};
  const response={id:input.model,object:"model_prices",operation:f.operation,input_mode:"image",contract_version:"c1",coverage:"enumerated",issues:[],filter,prices:{primary:table,max:table,expires_at:2000000000,unavailable:[]}};
  let calls=0;
  response.channel_parameters=[{provider:"apimart",channel_variant:"standard",operation:f.operation,input_mode:"image",parameter_rules:{quality:{behavior:"ignored",reason:"channel_parameter_unsupported",description:{zh:"不提供质量控制",en:"No quality control"}}}}];
  const client=createYirClient(async request=>{calls++;assert.ok(request.path.endsWith(`&resolution=${filter.resolution}&reference_count=2`));return structuredClone(response);});
  const got=await client.getModelPrices(input.model,f.operation,"image",{filter});
  assert.deepEqual(got.channel_parameters,response.channel_parameters);
  assert.equal(calculatePrice(got.prices.primary,input).amount,"1");
  assert.equal(calls,1);
  assert.throws(()=>validateModelPrices(response,input.model,f.operation,"image"),/response_invalid/);
  for(const bad of [ {...response,filter:{...filter,reference_count:1}}, {...response,filter:undefined} ]) assert.throws(()=>validateModelPrices(bad,input.model,f.operation,"image",filter),/response_invalid/);
  const wrong=structuredClone(response);
  wrong.prices.primary.rows[0].conditions.reference_image_count=[1];
  assert.throws(()=>validateModelPrices(wrong,input.model,f.operation,"image",filter),/response_invalid/);
  assert.throws(()=>client.getModelPrices(input.model,f.operation,"text",{filter}),/request_invalid/);
  assert.equal(calls,1);
});

for (const f of fixtures) test(`model price input: ${f.name}`, () => {
  const before = structuredClone(f.request);
  assert.deepEqual(buildPriceInput(f.operation, f.request, "fixture-v1"), f.expected);
  assert.deepEqual(f.request, before);
});

test("one model read supports repeated local prices and rejects unknown parameters", async () => {
  const f = fixtures[2];
  const conditions = Object.fromEntries(Object.entries(f.expected.parameters).map(([k,v])=>[k,[v]]));
  const table = {format:"yir-price-table-v1",version:"fixture-v1",purpose:"yir-cost",unit:"USD",scale:1000000,rows:[
    {id:"five",model:f.request.model,operation:f.operation,conditions,kind:"exact",price:{type:"total",amount:"184000"}},
    {id:"ten",model:f.request.model,operation:f.operation,conditions:{...conditions,duration:[10]},kind:"exact",price:{type:"total",amount:"368000"}},
  ]};
  const response = {id:f.request.model,object:"model_prices",operation:f.operation,input_mode:"text",contract_version:"test-v1",coverage:"enumerated",issues:[],prices:{primary:table,max:table,expires_at:2000000000,unavailable:[]}};
  for (const expires_at of [0,-1,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>validateModelPrices({...response,prices:{...response.prices,expires_at}},f.request.model,f.operation,"text"),/response_invalid/);
  }
  let calls=0;
  const client=createYirClient(async request=> {
    calls++;
    assert.equal(request.method,"GET");
    assert.equal(request.path,"/v1/models/klingai/kling-2.6?view=pricing&operation=generate_video&input_mode=text");
    return structuredClone(response);
  });
  const model=await client.getModelPrices(f.request.model,f.operation,"text");
  for (const duration of [5,10,5,10]) {
    const request={...f.request,parameters:{...f.request.parameters,duration}};
    assert.equal(calculatePrice(model.prices.primary,buildPriceInput(f.operation,request,table.version)).amount,duration===5?"184000":"368000");
  }
  assert.equal(calls,1);
  const input=buildPriceInput(f.operation,f.request,table.version);
  assert.equal(calculatePrice(table,{...input,parameters:{...input.parameters,resolution:"1080p"}}).reason,"no_match");
  assert.throws(()=>buildPriceInput(f.operation,{...f.request,routing:{preference:"cost"}},table.version),/routing_override/);
  await assert.rejects(async()=>client.getModelPrices("../private",f.operation,"text"),/request_invalid/);
  assert.equal(calls,1);
  const bad=createYirClient(async()=>({...response,id:"another/model"}));
  await assert.rejects(bad.getModelPrices(f.request.model,f.operation,"text"),/response_invalid/);
});
