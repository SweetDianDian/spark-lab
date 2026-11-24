import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { getAdvancedLab } from '../src/data/advanced-labs';
import { executeJavascript } from '../src/runtime/execution';
import { serializable } from '../src/runtime/core';
import { inspectExecution, type ExecutionInspection } from '../src/lib/execution-inspector';
import type { RunEvent } from '../src/types';

// Compile the real component for server rendering; stylesheet loading is the
// browser's responsibility and has no bearing on which evidence is displayed.
const source = readFileSync(new URL('../src/components/StepEvidence.tsx',import.meta.url),'utf8').replace(/^import ['"].*\.css['"];\s*$/gm,'');
const compiled = transformSync(source,{loader:'tsx',jsx:'automatic',format:'cjs',target:'es2022'}).code;
const componentModule = {exports:{} as {default:ComponentType<{nodeId:string;inspection:ExecutionInspection}>}};
new Function('require','module','exports',compiled)(createRequire(import.meta.url),componentModule,componentModule.exports);
const StepEvidence = componentModule.exports.default;

async function renderRun(id: string, code = getAdvancedLab(id)!.starter.javascript, nodeId = 'output') {
  const events: RunEvent[] = [];
  const emit = (type:string,nodeId:string,data:unknown) => events.push({id:String(events.length+1),seq:events.length+1,type,nodeId,title:nodeId,timestamp:0,data:serializable(data),source:'runtime'});
  await executeJavascript(code,'javascript',{
    step:(id,_title,data)=>{emit('step',id,data)},output:data=>{emit('output','output',data)},log:()=>{},
    model:async()=>{throw new Error('No model expected')},tool:async()=>{throw new Error('No tool expected')},
  });
  const inspection = inspectExecution({lessonId:id,nodeId,localSteps:true,events,code,language:'javascript',matchesSnapshot:true});
  return renderToStaticMarkup(createElement(StepEvidence,{nodeId,inspection}));
}

const changes = [
  {id:'tokens',from:'temperature = 0.7',to:'temperature = 0.2',before:/结束/,after:/继续/},
  {id:'transformer',from:'queryStrength = 1',to:'queryStrength = -1',before:/8\.0443/,after:/16\.0886/},
  {id:'training',from:'learningRate = 0.1',to:'learningRate = 0.8',before:/2\.5/,after:/90/},
  {id:'embeddings',from:"query = '模型 检索'",to:"query = '计算 工具'",before:/bestMatch<\/dt><dd>rag/,after:/bestMatch<\/dt><dd>calculator/},
  {id:'rag',from:"question = '记忆'",to:"question = '工具'",before:/\[d1\]/,after:/\[d2\]/},
  {id:'memory',from:'preserveCompletedIds = true',to:'preserveCompletedIds = false',before:/balance<\/dt><dd>46/,after:/balance<\/dt><dd>69/},
  {id:'mcp',from:'allowCall = true',to:'allowCall = false',before:/391/,after:/本地策略拒绝调用/},
  {id:'evaluation',from:'roundAnswers = true',to:'roundAnswers = false',before:/decimal/,after:/successRate<\/dt><dd>1/},
  {id:'multi-agent',from:'includeSources = true',to:'includeSources = false',before:/可交付/,after:/缺少有效来源/},
  {id:'capstone',from:'people = 17',to:'people = 19',before:/391/,after:/437/},
];
for (const change of changes) {
  test(`${change.id}: the actual parameter difference is visible without opening raw JSON`,async()=>{
    const code = getAdvancedLab(change.id)!.starter.javascript;
    const before = await renderRun(change.id,code);
    const after = await renderRun(change.id,code.replace(change.from,change.to));
    assert.notEqual(before,after);
    assert.match(before,change.before);
    assert.match(after,change.after);
    assert.doesNotMatch(before,/<pre/);
    assert.doesNotMatch(after,/<pre/);
    assert.match(after,/查看原始输入与结果/);
  });
}

test('tokenizer text does not hide its parameter fields and short vectors expose actual values',async()=>{
  const input = await renderRun('tokens',undefined,'input');
  assert.match(input,/temperature/);
  assert.match(input,/0\.7/);
  assert.match(input,/vocabulary/);
  const output = await renderRun('transformer');
  assert.match(output,/0\.8044/);
  assert.match(output,/0\.1956/);
  assert.match(output,/≈/);
});

test('large nested evidence stays bounded and points to its complete raw values',()=>{
  const inspection:ExecutionInspection={state:'completed',explanation:'',inputLabel:'输入',input:{},resultLabel:'结果',result:{rows:Array.from({length:20},(_,i)=>({id:i,vector:Array.from({length:12},()=>1.23456789)}))},location:null,locationNote:''};
  const html = renderToStaticMarkup(createElement(StepEvidence,{nodeId:'rank',inspection}));
  assert.match(html,/另 17 项|其余见原始数据/);
  assert.match(html,/查看原始输入与结果/);
  assert.doesNotMatch(html,/<pre/);
});
