import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountClient } from '../dist/server/account.js';

test('Account client uses its own host, key, envelope and typed settings path', async () => {
 const calls=[];
 const client=createAccountClient({apiKey:'yir_ak_test',fetch:async(url,init)=>{calls.push({url,init});return Response.json({code:200,data:{version:2}})}});
 const result=await client.routingProfiles.update('123',{default_preference:'speed',fallback_enabled:false});
 assert.equal(result.version,2);
 assert.equal(calls[0].url,'https://api.yir.ai/account/v1/routing-profiles/123');
 assert.equal(calls[0].init.method,'PATCH');
 assert.equal(calls[0].init.redirect,'manual');
 assert.equal(calls[0].init.headers.Authorization,'Bearer yir_ak_test');
 assert.deepEqual(JSON.parse(calls[0].init.body),{default_preference:'speed',fallback_enabled:false});
 assert.throws(()=>client.logs.get('../admin'),/account_id_invalid/);
 assert.equal(calls.length,1);
});
test('Account client rejects Gateway Keys and never retries settings writes',async()=>{
 assert.throws(()=>createAccountClient({apiKey:'yir_sk_test'}),/account_key_required/);
 let calls=0;
 const client=createAccountClient({apiKey:'yir_ak_test',fetch:async()=>{calls++;return Response.json({code:503,message:'unavailable'},{status:503})}});
 await assert.rejects(client.webhooks.create({url:'https://example.com/hook'}));assert.equal(calls,1);
});
test('Account client encodes analytics query and propagates authorization denial',async()=>{
 let called;
 const client=createAccountClient({apiKey:'yir_ak_test',fetch:async(url)=>{called=url;return Response.json({code:403,message:'forbidden'},{status:403})}});
 await assert.rejects(client.analytics.get({core_model:['a/b','c/d'],group_by:'model'}),e=>e.status===403);
 assert.equal(new URL(called).searchParams.get('core_model'),'a/b,c/d');
});
