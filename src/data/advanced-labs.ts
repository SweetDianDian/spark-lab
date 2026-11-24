import type { Language, Lesson } from '../types';

/** Executable local teaching experiments, not remote services or trained LLMs. */
export type AdvancedLab = {
  id: string; number: string; description: string; boundary: string;
  usesModel: false; nodes: Lesson['nodes']; starter: Record<Language, string>;
  challenge: Lesson['challenge'];
};

function experiment(id: string, number: string, description: string, boundary: string,
  middle: [string, string, string][], javascript: string, python: string, challenge: Lesson['challenge']): AdvancedLab {
  // JavaScript is also valid TypeScript. Give the first editable scalar an
  // explicit type while preserving the exact same algorithm in both versions.
  const typescript = javascript.replace(/const (\w+) = (true|false|\d+(?:\.\d+)?|'[^']*');/, (_match, name: string, value: string) =>
    `const ${name}: ${/^(true|false)$/.test(value) ? 'boolean' : value.startsWith("'") ? 'string' : 'number'} = ${value};`);
  return { id, number, description, boundary, usesModel: false, challenge,
    nodes: [
      { id: 'input', title: '准备输入', subtitle: description, codeMatch: "lab.step('input'" },
      ...middle.map(([nodeId, title, subtitle]) => ({ id: nodeId, title, subtitle, codeMatch: `lab.step('${nodeId}'` })),
      { id: 'output', title: '检查结果', subtitle: '查看这次实际计算与执行的结果', codeMatch: 'lab.output' },
    ], starter: { javascript, typescript, python } };
}

export const advancedLabs: readonly AdvancedLab[] = [
  experiment('tokens', '05', '用小词表切分文字，再用温度和固定随机落点抽取候选。',
    '手写小词表和固定 logits；不是任何线上模型的 tokenizer 或真实模型概率。',
    [['tokenize', '按词表切分', '最长匹配得到片段与编号'], ['sample', '计算概率并抽样', 'softmax 后用同一个落点选择']],
`// 小词表与固定分数，只演示分词和采样机制。
const temperature = 0.7; // 改成 0.2；保持 draw 不变
const text = 'AI学习AI';
const draw = 0.8;
const vocabulary = ['AI', '学习', '学', '习'];
const candidates = ['继续', '结束', '换个词'];
const logits = [2, 1, 0];
if (temperature <= 0 || draw < 0 || draw >= 1) throw new Error('temperature 必须 > 0，draw 必须在 [0,1)');
lab.step('input', '准备词表与采样参数', { text, vocabulary, candidates, logits, temperature, draw });
const pieces = [];
let rest = text;
while (rest.length) {
  const piece = [...vocabulary].sort((a,b) => b.length-a.length).find(word => rest.startsWith(word)) || Array.from(rest)[0];
  pieces.push(piece); rest = rest.slice(piece.length);
}
const ids = pieces.map(piece => vocabulary.includes(piece) ? vocabulary.indexOf(piece)+1 : 1000+piece.codePointAt(0));
lab.step('tokenize', '得到片段与编号', { input: { text, vocabulary }, result: { pieces, ids }, explanation: '词表变了，切分也可能改变。' });
const weights = logits.map(logit => Math.exp((logit-Math.max(...logits))/temperature));
const total = weights.reduce((sum,value) => sum+value, 0);
const probabilities = weights.map(value => value/total);
let cumulative = 0;
let selectedIndex = probabilities.length-1;
for (let index=0; index<probabilities.length; index++) {
  cumulative += probabilities[index];
  if (draw < cumulative) { selectedIndex = index; break; }
}
const selected = candidates[selectedIndex];
lab.step('sample', '由累计概率确定候选', { input: { logits, temperature, draw, candidates }, result: { probabilities, selectedIndex, selected } });
lab.output({ pieces, ids, probabilities, selected, temperature });`,
`# 小词表与固定分数，不是线上模型的真实概率。
import math
temperature = 0.7  # 改成 0.2；保持 draw 不变
text = 'AI学习AI'
draw = 0.8
vocabulary = ['AI', '学习', '学', '习']
candidates = ['继续', '结束', '换个词']
logits = [2, 1, 0]
if temperature <= 0 or not 0 <= draw < 1:
    raise ValueError('temperature 必须 > 0，draw 必须在 [0,1)')
lab.step('input', '准备词表与采样参数', dict(text=text, vocabulary=vocabulary, candidates=candidates, logits=logits, temperature=temperature, draw=draw))
pieces = []
rest = text
while rest:
    piece = next((word for word in sorted(vocabulary, key=len, reverse=True) if rest.startswith(word)), rest[0])
    pieces.append(piece)
    rest = rest[len(piece):]
ids = [vocabulary.index(piece)+1 if piece in vocabulary else 1000+ord(piece[0]) for piece in pieces]
lab.step('tokenize', '得到片段与编号', {'input': {'text': text, 'vocabulary': vocabulary}, 'result': {'pieces': pieces, 'ids': ids}, 'explanation': '词表变了，切分也可能改变。'})
weights = [math.exp((value-max(logits))/temperature) for value in logits]
probabilities = [value/sum(weights) for value in weights]
cumulative = 0
selectedIndex = len(probabilities)-1
for index, probability in enumerate(probabilities):
    cumulative += probability
    if draw < cumulative:
        selectedIndex = index
        break
selected = candidates[selectedIndex]
lab.step('sample', '由累计概率确定候选', {'input': dict(logits=logits, temperature=temperature, draw=draw, candidates=candidates), 'result': dict(probabilities=probabilities, selectedIndex=selectedIndex, selected=selected)})
lab.output(dict(pieces=pieces, ids=ids, probabilities=probabilities, selected=selected, temperature=temperature))`,
    { title: '固定落点，改变温度', description: '把 temperature 从 0.7 改成 0.2，保持 draw = 0.8。比较概率与选中的候选。', hint: '候选由累计概率区间决定；变尖的分布会改变同一个落点落在哪个区间。' }),

  experiment('transformer', '06', '用一个查询、两个键和值，亲手计算一次单头 Attention。',
    '二维单头注意力计算；没有训练、位置编码、多层网络或真实大模型内部数据，权重不是思维解释。',
    [['attention', '计算注意力权重', '点积、缩放、softmax'], ['mix', '加权汇总值', '把 V 按权重混合']],
`// 单头二维 Attention：权重表示本次混合比例，不是原因解释。
const queryStrength = 1; // 改成 -1
const query = [queryStrength, 0];
const keys = [[1,0], [-1,0]];
const values = [[10,0], [0,20]];
lab.step('input', '准备查询、键和值', { query, keys, values });
const scores = keys.map(key => key.reduce((sum,value,index) => sum+value*query[index],0)/Math.sqrt(query.length));
const exp = scores.map(score => Math.exp(score-Math.max(...scores)));
const weights = exp.map(value => value/exp.reduce((sum,item) => sum+item,0));
lab.step('attention', '缩放点积并归一化', { input: { query, keys }, result: { scores, weights } });
const mixed = values[0].map((_,dimension) => values.reduce((sum,value,index) => sum+weights[index]*value[dimension],0));
lab.step('mix', '按权重汇总值向量', { input: { values, weights }, result: { mixed } });
lab.output({ scores, weights, mixed, boundary: '单头小矩阵，不是完整 Transformer' });`,
`# 单头二维 Attention，不是模型的思维解释。
import math
queryStrength = 1  # 改成 -1
query = [queryStrength, 0]
keys = [[1, 0], [-1, 0]]
values = [[10, 0], [0, 20]]
lab.step('input', '准备查询、键和值', dict(query=query, keys=keys, values=values))
scores = [sum(a*b for a,b in zip(query,key))/math.sqrt(len(query)) for key in keys]
exp = [math.exp(score-max(scores)) for score in scores]
weights = [value/sum(exp) for value in exp]
lab.step('attention', '缩放点积并归一化', {'input': dict(query=query, keys=keys), 'result': dict(scores=scores, weights=weights)})
mixed = [sum(weights[index]*value[dimension] for index,value in enumerate(values)) for dimension in range(len(values[0]))]
lab.step('mix', '按权重汇总值向量', {'input': dict(values=values, weights=weights), 'result': dict(mixed=mixed)})
lab.output(dict(scores=scores, weights=weights, mixed=mixed, boundary='单头小矩阵，不是完整 Transformer'))`,
    { title: '让查询转向另一边', description: '把 queryStrength 从 1 改成 -1，比较权重与 mixed 向量。', hint: '查询与哪个 key 更一致，哪个 value 的混合比例就更高；两项权重之和仍为 1。' }),

  experiment('training', '07', '给 y = w × x 做一步梯度下降，比较参数更新前后的损失。',
    '只有一个参数的线性模型和两个样本；不下载或训练大语言模型，不证明泛化能力。',
    [['predict', '预测并计算损失', '均方误差和它的梯度'], ['update', '更新参数再测量', '学习率决定更新幅度']],
`// 训练一个只有 w 的小模型，不是大语言模型训练。
const learningRate = 0.1; // 改成 0.8，观察损失是否反而上升
const x = [1,2];
const targets = [2,4];
const weight = 0;
lab.step('input', '准备训练样本与学习率', { x, targets, weight, learningRate });
const predictions = x.map(value => weight*value);
const lossBefore = predictions.reduce((sum,value,index) => sum+(value-targets[index])**2,0)/x.length;
const gradient = 2*x.reduce((sum,value,index) => sum+(predictions[index]-targets[index])*value,0)/x.length;
lab.step('predict', '计算预测、均方误差与梯度', { input: { x, targets, weight }, result: { predictions, lossBefore, gradient } });
const nextWeight = weight-learningRate*gradient;
const nextPredictions = x.map(value => nextWeight*value);
const lossAfter = nextPredictions.reduce((sum,value,index) => sum+(value-targets[index])**2,0)/x.length;
lab.step('update', '执行一次参数更新', { input: { weight, learningRate, gradient }, result: { nextWeight, nextPredictions, lossAfter } });
lab.output({ weight, nextWeight, lossBefore, lossAfter, improved: lossAfter<lossBefore });`,
`# 单参数线性模型，不是大语言模型训练。
learningRate = 0.1  # 改成 0.8
x = [1, 2]
targets = [2, 4]
weight = 0
lab.step('input', '准备训练样本与学习率', dict(x=x, targets=targets, weight=weight, learningRate=learningRate))
predictions = [weight*value for value in x]
lossBefore = sum((value-target)**2 for value,target in zip(predictions,targets))/len(x)
gradient = 2*sum((prediction-target)*value for prediction,target,value in zip(predictions,targets,x))/len(x)
lab.step('predict', '计算预测、均方误差与梯度', {'input': dict(x=x, targets=targets, weight=weight), 'result': dict(predictions=predictions, lossBefore=lossBefore, gradient=gradient)})
nextWeight = weight-learningRate*gradient
nextPredictions = [nextWeight*value for value in x]
lossAfter = sum((value-target)**2 for value,target in zip(nextPredictions,targets))/len(x)
lab.step('update', '执行一次参数更新', {'input': dict(weight=weight, learningRate=learningRate, gradient=gradient), 'result': dict(nextWeight=nextWeight, nextPredictions=nextPredictions, lossAfter=lossAfter)})
lab.output(dict(weight=weight, nextWeight=nextWeight, lossBefore=lossBefore, lossAfter=lossAfter, improved=lossAfter<lossBefore))`,
    { title: '步子太大会怎样', description: '把 learningRate 从 0.1 改成 0.8，再比较 lossBefore 与 lossAfter。', hint: '这里梯度是 -10。学习率 0.1 把 w 从 0 推到 1；0.8 会推到 8，跨过合适的位置。' }),

  experiment('embeddings', '08', '把文本映射到可检查的词项向量，计算余弦相似度与排序。',
    '手写词项特征，不是调用训练好的 embedding 模型；同义词不在词表里就不会自动理解。',
    [['embed', '生成词项向量', '每一维都有可检查的含义'], ['rank', '按相似度排序', '余弦归一化再比较']],
`// 词项向量可检查，但不等于训练好的语义 embedding。
const query = '模型 检索'; // 改成 '计算 工具'
const vocabulary = ['模型','检索','计算','工具'];
const documents = [{id:'rag',text:'模型 检索 检索'}, {id:'calculator',text:'计算 工具 工具'}, {id:'mixed',text:'模型 工具'}];
lab.step('input', '准备查询、资料与特征词表', { query, vocabulary, documents });
const vectorize = text => vocabulary.map(word => text.split(/\\s+/).filter(token => token===word).length);
const queryVector = vectorize(query);
const vectors = documents.map(doc => ({...doc,vector:vectorize(doc.text)}));
lab.step('embed', '把词频写入向量', { input: { query, vocabulary, documents }, result: { queryVector, vectors } });
const cosine = (a,b) => { const norm = Math.hypot(...a)*Math.hypot(...b); return norm ? a.reduce((sum,value,index)=>sum+value*b[index],0)/norm : 0; };
const ranking = vectors.map(doc => ({id:doc.id,text:doc.text,score:cosine(queryVector,doc.vector)})).sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id));
lab.step('rank', '比较归一化相似度', { input: { queryVector, vectors }, result: { ranking } });
lab.output({ query, queryVector, ranking, bestMatch: ranking[0].id });`,
`# 可检查的词频向量，不是训练好的 embedding 模型。
import math
query = '模型 检索'  # 改成 '计算 工具'
vocabulary = ['模型', '检索', '计算', '工具']
documents = [dict(id='rag', text='模型 检索 检索'), dict(id='calculator', text='计算 工具 工具'), dict(id='mixed', text='模型 工具')]
lab.step('input', '准备查询、资料与特征词表', dict(query=query, vocabulary=vocabulary, documents=documents))
def vectorize(text):
    return [text.split().count(word) for word in vocabulary]
queryVector = vectorize(query)
vectors = [dict(doc, vector=vectorize(doc['text'])) for doc in documents]
lab.step('embed', '把词频写入向量', {'input': dict(query=query, vocabulary=vocabulary, documents=documents), 'result': dict(queryVector=queryVector, vectors=vectors)})
def cosine(a,b):
    norm = math.sqrt(sum(value*value for value in a)*sum(value*value for value in b))
    return sum(x*y for x,y in zip(a,b))/norm if norm else 0
ranking = sorted([dict(id=doc['id'], text=doc['text'], score=cosine(queryVector,doc['vector'])) for doc in vectors], key=lambda doc: (-doc['score'],doc['id']))
lab.step('rank', '比较归一化相似度', {'input': dict(queryVector=queryVector, vectors=vectors), 'result': dict(ranking=ranking)})
lab.output(dict(query=query, queryVector=queryVector, ranking=ranking, bestMatch=ranking[0]['id']))`,
    { title: '换一个检索方向', description: '把 query 从“模型 检索”改成“计算 工具”，比较 queryVector 与第一名。', hint: '再试一个不在词表里的同义词，观察零向量；这个小实验并没有自动获得语义能力。' }),

  experiment('rag', '09', '从本地资料检索片段，组装带来源编号的上下文与证据摘录。',
    '本地词项检索与 RAG 上下文组装；用原文摘录展示依据，不联网、不调用生成模型。',
    [['retrieve', '检索相关片段', '保留原文和来源编号'], ['compose', '组装带引用的回答', '只有找到的资料才能成为引用']],
`// 本章跑通检索和引用组装；用原文摘录代替生成模型。
const question = '记忆'; // 改成 '工具'
const topK = 1;
const documents = [{id:'d1',text:'记忆需要由程序保存，恢复时还要检查已完成操作。'}, {id:'d2',text:'工具请求不是执行结果，程序需要校验并执行工具。'}, {id:'d3',text:'评测使用固定案例检查输出是否符合预期。'}];
lab.step('input', '准备问题与本地片段', { question, topK, documents });
const terms = question.trim().split(/\\s+/).filter(Boolean);
const retrieved = documents.map(doc => ({...doc,score:terms.filter(term=>doc.text.includes(term)).length})).filter(doc=>doc.score>0).sort((a,b)=>b.score-a.score).slice(0,topK);
lab.step('retrieve', '按词项命中检索', { input: { question, topK, documents }, result: { retrieved } });
const citations = retrieved.map(doc=>doc.id);
const context = retrieved.map(doc=>'['+doc.id+'] '+doc.text).join('\\n');
const answer = retrieved.length ? retrieved.map(doc=>'['+doc.id+'] '+doc.text).join('\\n') : '资料不足，暂不回答。';
lab.step('compose', '用来源片段组装上下文与摘录', { input: { question, retrieved }, result: { context, citations, answer }, explanation: '这是证据摘录，不是模型生成的答案。' });
lab.output({ question, context, citations, answer, mode: '本地检索与证据摘录' });`,
`# 本地检索和引用组装，不调用生成模型。
question = '记忆'  # 改成 '工具'
topK = 1
documents = [dict(id='d1', text='记忆需要由程序保存，恢复时还要检查已完成操作。'), dict(id='d2', text='工具请求不是执行结果，程序需要校验并执行工具。'), dict(id='d3', text='评测使用固定案例检查输出是否符合预期。')]
lab.step('input', '准备问题与本地片段', dict(question=question, topK=topK, documents=documents))
terms = question.split()
ranked = [dict(doc, score=sum(term in doc['text'] for term in terms)) for doc in documents]
retrieved = sorted([doc for doc in ranked if doc['score']>0], key=lambda doc:-doc['score'])[:topK]
lab.step('retrieve', '按词项命中检索', {'input': dict(question=question, topK=topK, documents=documents), 'result': dict(retrieved=retrieved)})
citations = [doc['id'] for doc in retrieved]
context = '\\n'.join('['+doc['id']+'] '+doc['text'] for doc in retrieved)
answer = context if retrieved else '资料不足，暂不回答。'
lab.step('compose', '用来源片段组装上下文与摘录', {'input': dict(question=question, retrieved=retrieved), 'result': dict(context=context, citations=citations, answer=answer), 'explanation': '这是证据摘录，不是模型生成的答案。'})
lab.output(dict(question=question, context=context, citations=citations, answer=answer, mode='本地检索与证据摘录'))`,
    { title: '让引用跟着问题改变', description: '把 question 从“记忆”改成“工具”，检查检索到的 id、上下文与最终引用。', hint: '输入资料里不存在的词时，应得到资料不足；不要保留上一轮的引用。' }),

  experiment('memory', '10', '序列化账本状态后恢复，检查完成标记如何避免重复记账。',
    '在一次 worker 运行里模拟保存与恢复；没有跨运行持久存储，也没有真实付款。',
    [['checkpoint', '保存状态快照', '余额和完成标记一起保存'], ['resume', '恢复并继续', '已完成的操作可以跳过']],
`// 一次运行里的 JSON 保存/恢复，不是真实付款或跨运行存储。
const preserveCompletedIds = true; // 改成 false，观察重复计入
const operations = [{id:'meal-a',amount:23},{id:'meal-b',amount:23}];
lab.step('input', '准备可恢复的账本', { preserveCompletedIds, operations });
const firstState = { balance:operations[0].amount, completedIds:[operations[0].id] };
const serialized = JSON.stringify(firstState);
lab.step('checkpoint', '序列化第一次操作后的状态', { input: { operation:operations[0] }, result: { serialized, ...firstState } });
const restored = JSON.parse(serialized);
if (!preserveCompletedIds) restored.completedIds = [];
const executedIds = [], skippedIds = [];
for (const operation of operations) {
  if (restored.completedIds.includes(operation.id)) { skippedIds.push(operation.id); continue; }
  restored.balance += operation.amount;
  restored.completedIds.push(operation.id); executedIds.push(operation.id);
}
const resumed = { ...restored, executedIds, skippedIds };
lab.step('resume', '用完成标记决定跳过或执行', { input: { serialized, preserveCompletedIds, operations }, result: resumed });
lab.output(resumed);`,
`# 一次运行内模拟 JSON 保存/恢复，没有真实付款。
import json
preserveCompletedIds = True  # 改成 False
operations = [dict(id='meal-a', amount=23), dict(id='meal-b', amount=23)]
lab.step('input', '准备可恢复的账本', dict(preserveCompletedIds=preserveCompletedIds, operations=operations))
firstState = dict(balance=operations[0]['amount'], completedIds=[operations[0]['id']])
serialized = json.dumps(firstState)
lab.step('checkpoint', '序列化第一次操作后的状态', {'input': dict(operation=operations[0]), 'result': dict(firstState, serialized=serialized)})
restored = json.loads(serialized)
if not preserveCompletedIds:
    restored['completedIds'] = []
executedIds, skippedIds = [], []
for operation in operations:
    if operation['id'] in restored['completedIds']:
        skippedIds.append(operation['id'])
        continue
    restored['balance'] += operation['amount']
    restored['completedIds'].append(operation['id'])
    executedIds.append(operation['id'])
resumed = dict(restored, executedIds=executedIds, skippedIds=skippedIds)
lab.step('resume', '用完成标记决定跳过或执行', {'input': dict(serialized=serialized, preserveCompletedIds=preserveCompletedIds, operations=operations), 'result': resumed})
lab.output(resumed)`,
    { title: '只恢复余额够吗', description: '把 preserveCompletedIds 改成 false / False，比较 balance、executedIds 与 skippedIds。', hint: '保留完成标记得到 46；丢掉标记会把已经执行的第一项重复计入，得到 69。' }),

  experiment('mcp', '11', '在本地函数中完成能力发现、参数校验与工具调用消息往返。',
    '本地 JSON-RPC 风格的 MCP tools/list 与 tools/call 教学子集；没有真实服务器、传输、初始化握手或鉴权。',
    [['discover', '发现工具契约', '只列能力，不执行'], ['invoke', '检查权限并调用', '参数合法才产生结果']],
`// MCP 消息形状的本地子集；没有网络服务器或完整握手。
const allowCall = true; // 改成 false，观察权限拒绝
const people = 17, price = 23;
let executions = 0;
const tool = { name:'meal_total', description:'计算人数乘单价', inputSchema:{type:'object',properties:{people:{type:'number'},price:{type:'number'}},required:['people','price']} };
function localServer(request) {
  if (request.method==='tools/list') return {jsonrpc:'2.0',id:request.id,result:{tools:[tool]}};
  if (request.method!=='tools/call') return {jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'未知方法'}};
  if (!allowCall) return {jsonrpc:'2.0',id:request.id,error:{code:-32001,message:'本地策略拒绝调用'}};
  const args = request.params.arguments;
  if (request.params.name!==tool.name || !Number.isFinite(args.people) || !Number.isFinite(args.price) || args.people<0 || args.price<0) return {jsonrpc:'2.0',id:request.id,error:{code:-32602,message:'参数不合法'}};
  executions++;
  return {jsonrpc:'2.0',id:request.id,result:{content:[{type:'text',text:JSON.stringify({total:args.people*args.price})}],isError:false}};
}
lab.step('input', '准备本地调用策略', { allowCall, people, price });
const listRequest = {jsonrpc:'2.0',id:1,method:'tools/list'};
const discovery = localServer(listRequest);
lab.step('discover', '只发现工具，没有执行', { input:listRequest, result:{response:discovery,executions} });
const callRequest = {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:discovery.result.tools[0].name,arguments:{people,price}}};
const response = localServer(callRequest);
lab.step('invoke', '本地检查后返回消息', { input:callRequest, result:{response,executions} });
lab.output({ response, executions, boundary:'本地协议子集，没有连接 MCP 服务器' });`,
`# MCP 消息形状的本地子集，没有网络服务器或完整握手。
import json, math
allowCall = True  # 改成 False
people, price = 17, 23
executions = 0
tool = dict(name='meal_total', description='计算人数乘单价', inputSchema=dict(type='object', properties=dict(people=dict(type='number'), price=dict(type='number')), required=['people','price']))
def localServer(request):
    global executions
    if request['method']=='tools/list':
        return dict(jsonrpc='2.0', id=request['id'], result=dict(tools=[tool]))
    if request['method']!='tools/call':
        return dict(jsonrpc='2.0', id=request['id'], error=dict(code=-32601, message='未知方法'))
    if not allowCall:
        return dict(jsonrpc='2.0', id=request['id'], error=dict(code=-32001, message='本地策略拒绝调用'))
    args = request['params']['arguments']
    if request['params']['name']!=tool['name'] or not all(isinstance(args.get(key),(int,float)) and not isinstance(args.get(key),bool) and math.isfinite(args[key]) and args[key]>=0 for key in ['people','price']):
        return dict(jsonrpc='2.0', id=request['id'], error=dict(code=-32602, message='参数不合法'))
    executions += 1
    return dict(jsonrpc='2.0', id=request['id'], result=dict(content=[dict(type='text', text=json.dumps(dict(total=args['people']*args['price'])))], isError=False))
lab.step('input', '准备本地调用策略', dict(allowCall=allowCall, people=people, price=price))
listRequest = dict(jsonrpc='2.0', id=1, method='tools/list')
discovery = localServer(listRequest)
lab.step('discover', '只发现工具，没有执行', {'input': listRequest, 'result': dict(response=discovery, executions=executions)})
callRequest = dict(jsonrpc='2.0', id=2, method='tools/call', params=dict(name=discovery['result']['tools'][0]['name'], arguments=dict(people=people, price=price)))
response = localServer(callRequest)
lab.step('invoke', '本地检查后返回消息', {'input': callRequest, 'result': dict(response=response, executions=executions)})
lab.output(dict(response=response, executions=executions, boundary='本地协议子集，没有连接 MCP 服务器'))`,
    { title: '发现能力不等于获准执行', description: '把 allowCall 改成 false / False，检查发现列表仍然存在，但调用返回错误、executions 保持 0。', hint: '本地策略错误码 -32001 仅是本实验自定义；它不是 MCP 通用权限认证实现。' }),

  experiment('evaluation', '12', '运行固定测试集，再按容差规则统计成功率与失败样本。',
    '评测一个本地计算函数，不调用模型；这里只测指定案例，不代表任务总体能力。',
    [['execute', '运行同一组案例', '记录实际值和期望值'], ['score', '按规则评分', '保留失败样本，不只报平均数']],
`// 固定评测集：先看实际输出，再讨论成功率。
const roundAnswers = true; // 改成 false
const tolerance = 0.01;
const cases = [{id:'integer',a:17,b:23,expected:391},{id:'decimal',a:1.25,b:2,expected:2.5},{id:'zero',a:0,b:9,expected:0}];
lab.step('input', '准备评测集与误差容限', { roundAnswers, tolerance, cases });
const rows = cases.map(item => { const value=item.a*item.b; return {...item,actual:roundAnswers?Math.floor(value+0.5):value}; });
lab.step('execute', '实际运行所有案例', { input:{cases,roundAnswers}, result:{rows} });
const scored = rows.map(row=>({...row,absoluteError:Math.abs(row.actual-row.expected),passed:Math.abs(row.actual-row.expected)<=tolerance}));
const passed = scored.filter(row=>row.passed).length;
const failures = scored.filter(row=>!row.passed).map(row=>row.id);
const summary = { total:scored.length, passed, successRate:passed/scored.length, failures, scored };
lab.step('score', '按容差统计而非凭感觉判断', { input:{rows,tolerance}, result:summary });
lab.output(summary);`,
`# 评测一个本地函数；指定案例不能代表总体能力。
import math
roundAnswers = True  # 改成 False
tolerance = 0.01
cases = [dict(id='integer',a=17,b=23,expected=391), dict(id='decimal',a=1.25,b=2,expected=2.5), dict(id='zero',a=0,b=9,expected=0)]
lab.step('input', '准备评测集与误差容限', dict(roundAnswers=roundAnswers, tolerance=tolerance, cases=cases))
rows = [dict(item, actual=math.floor(item['a']*item['b']+0.5) if roundAnswers else item['a']*item['b']) for item in cases]
lab.step('execute', '实际运行所有案例', {'input': dict(cases=cases,roundAnswers=roundAnswers), 'result': dict(rows=rows)})
scored = [dict(row, absoluteError=abs(row['actual']-row['expected']), passed=abs(row['actual']-row['expected'])<=tolerance) for row in rows]
passed = sum(row['passed'] for row in scored)
failures = [row['id'] for row in scored if not row['passed']]
summary = dict(total=len(scored), passed=passed, successRate=passed/len(scored), failures=failures, scored=scored)
lab.step('score', '按容差统计而非凭感觉判断', {'input': dict(rows=rows,tolerance=tolerance), 'result': summary})
lab.output(summary)`,
    { title: '改好一个失败样本', description: '把 roundAnswers 改成 false / False，检查 decimal 案例和成功率如何变化。', hint: '总运行成功不等于所有案例通过。本章保留有失败样本的评测报告，也算跑通评测流程。' }),

  experiment('multi-agent', '13', '让资料整理和核验两个本地角色函数通过结构化数据交接。',
    '两个确定性角色函数组成的工作流，不是两个自主大模型 Agent，也没有真实并行或协作成本测量。',
    [['handoff', '结构化交接', '资料、来源与金额一起交给下一角色'], ['review', '核验后接受或退回', '检查来源缺失和金额错误']],
`// 两个本地角色函数，不是假装有两个大模型在讨论。
const includeSources = true; // 改成 false
const task = { people:17, price:23 };
const sources = [{id:'menu',text:'本次菜单每人 23 元。',price:23}];
lab.step('input', '准备共享任务与资料', { task, sources, includeSources });
function researcher(task, sources) {
  return {role:'researcher',total:task.people*sources[0].price,sourceIds:includeSources?[sources[0].id]:[],facts:{people:task.people,price:sources[0].price}};
}
const packet = researcher(task,sources);
lab.step('handoff', '整理角色交出结构化数据', { input:{task,sources}, result:{packet} });
function reviewer(packet) {
  const issues = [];
  if (!packet.sourceIds.length || packet.sourceIds.some(id=>!sources.some(source=>source.id===id))) issues.push('缺少有效来源');
  if (packet.total!==task.people*task.price) issues.push('金额不一致');
  return {role:'reviewer',accepted:issues.length===0,issues,total:packet.total,sourceIds:[...packet.sourceIds]};
}
const review = reviewer(packet);
lab.step('review', '核验角色检查交接内容', { input:{packet}, result:{review} });
lab.output({ packet, review, status:review.accepted?'可交付':'退回补充' });`,
`# 两个确定性本地角色函数，不是两个自主模型 Agent。
includeSources = True  # 改成 False
task = dict(people=17, price=23)
sources = [dict(id='menu',text='本次菜单每人 23 元。',price=23)]
lab.step('input', '准备共享任务与资料', dict(task=task, sources=sources, includeSources=includeSources))
def researcher(task,sources):
    return dict(role='researcher',total=task['people']*sources[0]['price'],sourceIds=[sources[0]['id']] if includeSources else [],facts=dict(people=task['people'],price=sources[0]['price']))
packet = researcher(task,sources)
lab.step('handoff', '整理角色交出结构化数据', {'input': dict(task=task,sources=sources), 'result': dict(packet=packet)})
def reviewer(packet):
    issues = []
    if not packet['sourceIds'] or any(not any(source['id']==item for source in sources) for item in packet['sourceIds']):
        issues.append('缺少有效来源')
    if packet['total']!=task['people']*task['price']:
        issues.append('金额不一致')
    return dict(role='reviewer',accepted=not issues,issues=issues,total=packet['total'],sourceIds=packet['sourceIds'])
review = reviewer(packet)
lab.step('review', '核验角色检查交接内容', {'input': dict(packet=packet), 'result': dict(review=review)})
lab.output(dict(packet=packet,review=review,status='可交付' if review['accepted'] else '退回补充'))`,
    { title: '拿走交接中的来源', description: '把 includeSources 改成 false / False，比较金额不变时，review 为什么仍会退回。', hint: '角色数量不能补回丢失的信息；核验器只能根据实际收到的数据判断。' }),

  experiment('capstone', '14', '组合本地资料选择、费用计算与预算验收，产出带引用的活动报告。',
    '确定性的本地研究流程，资料与报价固定；没有实时搜索或自主模型决策，报告不是现实报价。',
    [['research', '检索资料并计算', '来源支持单价，人数决定总额'], ['verify', '按预算核验报告', '引用和金额都能回到证据']],
`// 本地研究报告：资料固定，不是实时餐厅报价。
const people = 17; // 改成 19，预算保持不变
const budget = 420;
const topic = '聚餐';
const documents = [{id:'menu-23',topic:'聚餐',text:'教学菜单：每人 23 元。',unitPrice:23},{id:'bus-8',topic:'交通',text:'教学车票：每人 8 元。',unitPrice:8}];
lab.step('input', '准备研究任务与验收条件', { people, budget, topic, documents });
const found = documents.find(doc=>doc.topic===topic);
if (!found) throw new Error('没有找到相关资料，不能编造报价');
const source = {...found}; // 独立的来源快照
const calculation = {people,unitPrice:source.unitPrice,total:people*source.unitPrice};
lab.step('research', '找到依据并计算总费用', { input:{topic,people,documents}, result:{source,calculation} });
const checks = {sourceExists:documents.some(doc=>doc.id===source.id),arithmeticCorrect:calculation.total===people*source.unitPrice,withinBudget:calculation.total<=budget};
const report = {title:'活动费用核验报告',people,total:calculation.total,budget,citations:[source.id],quote:source.text,approved:Object.values(checks).every(Boolean),checks};
lab.step('verify', '逐项核验后决定是否通过', { input:{source,calculation,budget}, result:{report} });
lab.output(report);`,
`# 固定本地资料组成的报告，不是实时餐厅报价。
people = 17  # 改成 19，预算保持不变
budget = 420
topic = '聚餐'
documents = [dict(id='menu-23',topic='聚餐',text='教学菜单：每人 23 元。',unitPrice=23),dict(id='bus-8',topic='交通',text='教学车票：每人 8 元。',unitPrice=8)]
lab.step('input', '准备研究任务与验收条件', dict(people=people,budget=budget,topic=topic,documents=documents))
source = next((doc for doc in documents if doc['topic']==topic), None)
if source is None:
    raise ValueError('没有找到相关资料，不能编造报价')
calculation = dict(people=people,unitPrice=source['unitPrice'],total=people*source['unitPrice'])
lab.step('research', '找到依据并计算总费用', {'input':dict(topic=topic,people=people,documents=documents),'result':dict(source=source,calculation=calculation)})
checks = dict(sourceExists=any(doc['id']==source['id'] for doc in documents),arithmeticCorrect=calculation['total']==people*source['unitPrice'],withinBudget=calculation['total']<=budget)
report = dict(title='活动费用核验报告',people=people,total=calculation['total'],budget=budget,citations=[source['id']],quote=source['text'],approved=all(checks.values()),checks=checks)
lab.step('verify', '逐项核验后决定是否通过', {'input':dict(source=source,calculation=calculation,budget=budget),'result':dict(report=report)})
lab.output(report)`,
    { title: '预算边界不能靠文案放行', description: '把 people 从 17 改成 19，保持 budget = 420。检查总额、预算判定与最终报告。', hint: '391 没超预算，437 超了。报告应保留真实计算与引用，并把 approved 改成 false。' }),
];

export function getAdvancedLab(id: string): AdvancedLab | undefined {
  return advancedLabs.find(lab => lab.id === id);
}
