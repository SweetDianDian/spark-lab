import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import { advancedLabs, getAdvancedLab } from '../src/data/advanced-labs';
import { lessons } from '../src/data/lessons';
import { executeJavascript, type LabAPI } from '../src/runtime/execution';
import { serializable } from '../src/runtime/core';
import { nodeExecutionState, validateLessonRun } from '../src/lib/progress';
import type { Language, RunEvent, RunResult } from '../src/types';

let pythonPromise: Promise<PyodideInterface> | undefined;
let currentPythonLab: LabAPI;
async function pythonRuntime() {
  pythonPromise ??= (async () => {
    const runtime = await loadPyodide({ indexURL: resolve('node_modules/pyodide') + '/' });
    runtime.registerJsModule('_advanced_test_bridge', { emit: (method: string, payload: string) => {
      const args = JSON.parse(payload);
      if (method === 'step') currentPythonLab.step(args[0],args[1],args[2]);
      else if (method === 'output') currentPythonLab.output(args[0]);
      else currentPythonLab.log(args[0]);
    } });
    await runtime.runPythonAsync(`
import json as _json
from _advanced_test_bridge import emit as _emit
class _Lab:
    def step(self, node, title, data=None):
        _emit('step', _json.dumps([node,title,data], ensure_ascii=False))
    def output(self, value):
        _emit('output', _json.dumps([value], ensure_ascii=False))
    def log(self, value):
        _emit('log', _json.dumps([value], ensure_ascii=False))
lab = _Lab()
`);
    return runtime;
  })();
  return pythonPromise;
}

async function execute(id: string, language: Language, code = getAdvancedLab(id)!.starter[language]): Promise<RunResult> {
  const events: RunEvent[] = [];
  let output: unknown = null;
  const emit = (type: string, nodeId: string, title: string, data: unknown) => {
    const seq = events.length + 1;
    events.push({ id:`${id}:${seq}`,seq,timestamp:seq,type,nodeId,title,data:serializable(data),source:'runtime' });
  };
  const lab: LabAPI = {
    model: async () => { throw new Error('Local chapters must not call a model'); },
    tool: async () => { throw new Error('Local chapters must not call runtime tools'); },
    step: (nodeId,title,data) => {
      assert.match(nodeId,/^[a-z][a-z0-9-]{0,31}$/);
      emit('step',nodeId,title,data);
    },
    log: value => emit('log','input','代码日志',value),
    output: value => { output=serializable(value);emit('output','output','最终输出',output); },
  };
  emit('run.started','input','开始运行',{language});
  if (language === 'python') {
    currentPythonLab = lab;
    const runtime = await pythonRuntime();
    runtime.globals.set('_lesson_source',code);
    await runtime.runPythonAsync("exec(compile(_lesson_source, 'experiment.py', 'exec'), {'lab': lab})");
  } else await executeJavascript(code,language,lab);
  emit('run.completed','output','运行完成',{output});
  return {id,events,output,duration:1,status:'completed'};
}

type Expected = (value: Record<string, any>) => void;
const scenarios: Record<string, { parameter: string; change: string; baseline: Expected; changed: Expected }> = {
  tokens: { parameter:'temperature',change:'0.2',baseline:value=>assert.equal(value.selected,'结束'),changed:value=>assert.equal(value.selected,'继续') },
  transformer: { parameter:'queryStrength',change:'-1',baseline:value=>assert.ok(value.weights[0]>value.weights[1]),changed:value=>assert.ok(value.weights[0]<value.weights[1]) },
  training: { parameter:'learningRate',change:'0.8',baseline:value=>assert.deepEqual([value.nextWeight,value.lossBefore,value.lossAfter],[1,10,2.5]),changed:value=>assert.deepEqual([value.nextWeight,value.lossAfter,value.improved],[8,90,false]) },
  embeddings: { parameter:'query',change:"'计算 工具'",baseline:value=>assert.equal(value.bestMatch,'rag'),changed:value=>assert.equal(value.bestMatch,'calculator') },
  rag: { parameter:'question',change:"'工具'",baseline:value=>assert.deepEqual(value.citations,['d1']),changed:value=>assert.deepEqual(value.citations,['d2']) },
  memory: { parameter:'preserveCompletedIds',change:'false',baseline:value=>assert.deepEqual([value.balance,value.skippedIds],[46,['meal-a']]),changed:value=>assert.deepEqual([value.balance,value.executedIds,value.skippedIds],[69,['meal-a','meal-b'],[]]) },
  mcp: { parameter:'allowCall',change:'false',baseline:value=>assert.equal(JSON.parse(value.response.result.content[0].text).total,391),changed:value=>assert.deepEqual([value.executions,value.response.error.code],[0,-32001]) },
  evaluation: { parameter:'roundAnswers',change:'false',baseline:value=>assert.deepEqual([value.passed,value.failures],[2,['decimal']]),changed:value=>assert.deepEqual([value.passed,value.successRate,value.failures],[3,1,[]]) },
  'multi-agent': { parameter:'includeSources',change:'false',baseline:value=>assert.equal(value.review.accepted,true),changed:value=>assert.deepEqual([value.review.accepted,value.review.issues],[false,['缺少有效来源']]) },
  capstone: { parameter:'people',change:'19',baseline:value=>assert.deepEqual([value.total,value.approved],[391,true]),changed:value=>assert.deepEqual([value.total,value.approved],[437,false]) },
};
function modified(code: string, language: Language, parameter: string, value: string) {
  const pattern = new RegExp(`^(${language === 'python' ? '' : 'const '}${parameter}(?:\\s*:\\s*\\w+)?\\s*=\\s*)([^;\\n#]+)`, 'm');
  const literal = language === 'python' && value === 'false' ? 'False' : value;
  assert.match(code,pattern);
  return code.replace(pattern,(_match,prefix:string) => prefix+literal+(language==='python'?' ':''));
}

test('all fourteen lessons have a coherent order and ten local experiments expose explicit boundaries', () => {
  assert.equal(lessons.length,14);
  assert.ok(lessons.every(lesson=>lesson.available && lesson.nodes.length>=3));
  assert.deepEqual(lessons.map(lesson=>lesson.number),Array.from({length:14},(_,i)=>String(i+1).padStart(2,'0')));
  assert.deepEqual(advancedLabs.map(lab=>lab.id),lessons.slice(4).map(lesson=>lesson.id));
  for (const lab of advancedLabs) {
    assert.equal(lab.usesModel,false);
    assert.ok(lab.boundary.length>20);
    assert.ok(lessons.find(lesson=>lesson.id===lab.id)?.concept.some(item=>item.body===lab.boundary));
  }
});

for (const language of ['typescript','javascript','python'] as const) {
  for (const lab of advancedLabs) {
    test(`${lab.id}: actual ${language} baseline and one-variable intervention execute with valid evidence`, async () => {
      const scenario = scenarios[lab.id];
      const baseline = await execute(lab.id,language);
      assert.equal(validateLessonRun(lab.id,baseline).passed,true,validateLessonRun(lab.id,baseline).reason);
      scenario.baseline(baseline.output as Record<string,any>);
      for (const node of lab.nodes) assert.equal(nodeExecutionState(baseline.events,node.id),'completed',`${lab.id}/${node.id}`);
      const changed = await execute(lab.id,language,modified(lab.starter[language],language,scenario.parameter,scenario.change));
      assert.equal(validateLessonRun(lab.id,changed).passed,true,validateLessonRun(lab.id,changed).reason);
      scenario.changed(changed.output as Record<string,any>);
      assert.notDeepEqual(changed.output,baseline.output);
    });
  }
}

test('new chapter completion rejects missing steps, altered output, wrong ordering, and empty/manual output', async () => {
  for (const lab of advancedLabs) {
    const happy = await execute(lab.id,'javascript');
    const first = lab.nodes[1].id;
    assert.equal(validateLessonRun(lab.id,{...happy,events:happy.events.filter(event=>event.nodeId!==first)}).passed,false,lab.id);
    assert.equal(validateLessonRun(lab.id,{...happy,output:{invented:true}}).passed,false,lab.id);
    assert.equal(validateLessonRun(lab.id,{...happy,events:happy.events.map(event=>event.nodeId===first?{...event,seq:999}:event)}).passed,false,lab.id);
    const arbitrary = {...happy,events:happy.events.map(event=>event.type==='step'&&event.nodeId!=='input'?{...event,data:{input:{},result:{success:true}}}:event)};
    assert.equal(validateLessonRun(lab.id,arbitrary).passed,false,lab.id);
    assert.equal(validateLessonRun(lab.id,{...happy,status:'failed'}).passed,false,lab.id);
    assert.equal(validateLessonRun(lab.id,{...happy,status:'cancelled'}).passed,false,lab.id);
    const manual = await execute(lab.id,'javascript',"lab.output('hi');");
    assert.equal(validateLessonRun(lab.id,manual).passed,false,lab.id);
  }
});

test('no-hit retrieval and zero-vector similarity remain honest results, not reused evidence', async () => {
  for (const id of ['rag','embeddings']) {
    const lab = getAdvancedLab(id)!;
    const parameter = id==='rag'?'question':'query';
    const result = await execute(id,'javascript',modified(lab.starter.javascript,'javascript',parameter,"'不存在的词'"));
    assert.equal(validateLessonRun(id,result).passed,true);
    const out = result.output as Record<string,any>;
    if (id==='rag') { assert.deepEqual(out.citations,[]);assert.equal(out.answer,'资料不足，暂不回答。'); }
    else assert.ok(out.ranking.every((item:Record<string,any>)=>item.score===0));
  }
});

test('structured custom step evidence completes only its node and retains failures at output', () => {
  const event: RunEvent = {id:'1',seq:1,timestamp:0,type:'step',nodeId:'rank',title:'排序',data:{input:{vectors:[]},result:{ranking:[]}},source:'runtime'};
  assert.equal(nodeExecutionState([event],'rank'),'completed');
  assert.equal(nodeExecutionState([{...event,data:'just a label'}],'rank'),'idle');
  assert.equal(nodeExecutionState([event],'embed'),'idle');
  assert.equal(nodeExecutionState([event,{...event,id:'2',seq:2,type:'run.failed',nodeId:'output',data:{error:'failed'}}],'output'),'failed');
});
