import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePricedRequest,previewCost} from '../examples/price-preview.mjs';
import {buildPriceInput} from '../dist/index.js';

test('cost preview distinguishes loading, expiry and missing prices and pins request defaults',()=>{
  const request={model:'klingai/kling-2.6',input:{type:'text',prompt:'test'},parameters:{duration:10}};
  const original=structuredClone(request);
  const prepared=preparePricedRequest('generate_video',request);
  assert.equal(prepared.parameters.n,1);
  assert.equal(prepared.parameters.resolution,'720p');
  assert.equal(prepared.parameters.generate_audio,false);
  assert.deepEqual(request,original);
  const input=buildPriceInput('generate_video',prepared,'v1');
  const table={format:'yir-price-table-v1',version:'v1',purpose:'yir-cost',unit:'USD',scale:1000000,rows:[
    {id:'one',model:prepared.model,operation:'generate_video',conditions:Object.fromEntries(Object.entries(input.parameters).map(([key,value])=>[key,[value]])),kind:'exact',price:{type:'total',amount:'368000'}},
  ]};
  const model={id:prepared.model,operation:'generate_video',input_mode:'text',filter:{resolution:'720p'},prices:{primary:table,expires_at:100}};
  const preview=(m,r=request,now=99)=>previewCost(m,'generate_video',r,now);
  assert.equal(preview(undefined).state,'load_required');
  assert.equal(preview(model,request,100).state,'refresh_required');
  assert.equal(preview(model).price.amount,'368000');
  assert.deepEqual(preview(model).request,prepared);
  // A changed server default cannot override values already carried by the request.
  const serverParameters={n:2,resolution:'1080p',generate_audio:true,...prepared.parameters};
  assert.deepEqual(buildPriceInput('generate_video',{...prepared,parameters:serverParameters},'v1'),input);
  assert.equal(preview(model,{...request,parameters:{duration:10,resolution:'1080p'}}).state,'load_required');
  assert.deepEqual(preview(model,{...request,parameters:{duration:5}}),{state:'unavailable',reason:'no_match'});
  assert.equal(preview({...model,id:'another/model'}).state,'load_required');
  assert.throws(()=>preview(model,request,NaN),/invalid_clock/);
});
