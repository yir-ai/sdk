import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import * as browser from '@yir/sdk/browser';
import * as shared from '@yir/sdk/shared';
import {createNodeHttpTransport, createNodeYirClient} from '@yir/sdk/server';

test('browser/shared 导出纯逻辑并共享同一实现',()=>{
  assert.equal(browser.calculatePrice,shared.calculatePrice);
  assert.equal(typeof browser.validateGeneration,'function');
  for(const entry of [browser,shared]) for(const name of ['createYirClient','createNodeYirClient','createNodeHttpTransport','verifyWebhookSignature','createYirAIProvider']) assert.equal(name in entry,false);
});

test('密钥客户端在浏览器中先拒绝，不能读取密钥或发送请求',()=>{
  const previous = ['window','document'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
  try {
    Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
    Object.defineProperty(globalThis,'document',{configurable:true,value:{}});
    const options = { get apiKey(){assert.fail('must not read key');}, fetch(){assert.fail('must not fetch');} };
    assert.throws(()=>createNodeHttpTransport(options),/server_client_not_allowed_in_browser/);
    assert.throws(()=>createNodeYirClient(options),/server_client_not_allowed_in_browser/);
  } finally {for(const [key,descriptor] of previous) {if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});

test('browser/shared 完整源码依赖图不得引用 server 或外部运行时依赖',()=>{
  const root=fileURLToPath(new URL('../src/',import.meta.url));
  const seen=new Set();
  function visit(file){
    if(seen.has(file))return;seen.add(file);
    const relative=path.relative(root,file).replaceAll('\\','/');
    assert.ok(relative.startsWith('browser/')||relative.startsWith('shared/'),relative);
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    function inspect(node){
      let specifier;
      if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))specifier=node.moduleSpecifier;
      if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(source)==='require'))specifier=node.arguments[0];
      if(specifier){assert.ok(ts.isStringLiteral(specifier),'dependency must be literal');assert.ok(specifier.text.startsWith('.'),'external dependency: '+specifier.text);visit(path.resolve(path.dirname(file),specifier.text.replace(/\.js$/,'.ts')));}
      ts.forEachChild(node,inspect);
    }
    inspect(source);
  }
  visit(path.join(root,'browser/index.ts'));visit(path.join(root,'shared/index.ts'));
});

test('浏览器真实打包只包含 browser/shared，不包含 server 或 Node 模块',async()=>{
  const {build}=await import('esbuild');
  const result=await build({absWorkingDir:fileURLToPath(new URL('../',import.meta.url)),entryPoints:['src/browser/index.ts'],bundle:true,platform:'browser',format:'esm',write:false,metafile:true});
  for(const name of Object.keys(result.metafile.inputs)){const normalized=name.replaceAll('\\','/');assert.ok(normalized.startsWith('src/browser/')||normalized.startsWith('src/shared/'),normalized);}
  assert.ok(result.outputFiles[0].text.includes('calculatePrice'));
  assert.equal(result.outputFiles[0].text.includes('YIR_API_KEY'),false);
});
