import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareImage,submitSavedImage} from '../examples/quickstart.mjs';
const input={model:'openai/gpt-image-2',prompt:'A mountain lake',parameters:{resolution:'1K',n:1}};
test('快速开始先报价并带上已批准预算，保存请求和幂等键后才能提交/恢复',async()=>{
 const calls=[];
 const client={quoteImage:async request=>{calls.push(['quote',request]);return {supply:{available:true},primary:{kind:'fixed',amount:'0.02'}};},submitImage:async (request,key)=>{calls.push(['submit',structuredClone(request),key]);return {id:'1'};}};
 const prepared=await prepareImage(client,input,'0.05');
 assert.equal(prepared.estimate,'0.02');
 assert.equal(calls.length,1);
 assert.equal(prepared.request.max_cost,'0.05');
 const saved=JSON.parse(JSON.stringify({...prepared,idempotencyKey:'test-saved-order'}));
 await submitSavedImage(client,saved);await submitSavedImage(client,saved);
 assert.deepEqual(calls[1],calls[2]);
 await assert.rejects(()=>submitSavedImage(client,prepared),/saved_authorization_required/);
 assert.equal(calls.length,3);
});
test('无供应或未批准预算不得形成授权',async()=>{
 for(const quote of [{supply:{available:false}},{supply:{available:true},primary:{kind:'unavailable',amount:null}}]){
  await assert.rejects(()=>prepareImage({quoteImage:async()=>quote},input,'0.05'),/supply_unavailable/);
 }
 await assert.rejects(()=>prepareImage({quoteImage:async()=>{throw new Error('unexpected');}},input),/approved_budget_required/);
});
