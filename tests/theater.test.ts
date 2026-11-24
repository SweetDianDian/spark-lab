import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFrames, agentOutcome, apiCallFrames, apiCallPayload, apiOutputCase, chooseCandidate, contextPayload, samplingCase, samplingDistribution, theaterReturnPath, toolExecutionCase, toolFrames, validateOperands } from '../src/data/theater';
import { getLearningPathItem, getPrincipleDefinition, LEARNING_PATH, PRINCIPLE_DEFINITIONS, theaterFrameId } from '../src/data/learning-path';

test('API-call teaching preserves the edited message across the request and parsed response', () => {
  const original = apiCallPayload('解释大语言模型。');
  const changed = apiCallPayload('解释 Agent。');
  assert.deepEqual(changed.request.messages, [{ role: 'user', content: '解释 Agent。' }]);
  assert.notDeepEqual(changed.request, original.request);
  assert.match(changed.response.text, /教学示例.*Agent/);
  assert.deepEqual(changed.response.toolCalls, []);
  assert.deepEqual(apiCallFrames().map(theaterFrameId), ['input', 'request', 'model', 'answer']);
});

test('hiding output changes only the presentation while preserving request and response', () => {
  const shown = apiOutputCase('用一句话解释大语言模型。', true);
  const hidden = apiOutputCase('用一句话解释大语言模型。', false);
  assert.deepEqual(shown.request, hidden.request);
  assert.deepEqual(shown.response, hidden.response);
  assert.equal(shown.displayedText, shown.response.text);
  assert.equal(hidden.displayedText, null);
  assert.equal(hidden.source, 'teaching-example');
});

test('a tool request is not a result, and only valid executed requests produce numbers', () => {
  const requested = toolExecutionCase('17', '23', false);
  const executed = toolExecutionCase('17', '23', true);
  assert.deepEqual(requested.request, executed.request);
  assert.equal(requested.status, 'request-only');
  assert.equal(requested.result, null);
  assert.equal(executed.status, 'executed');
  assert.equal(executed.result, 391);
  assert.equal(toolExecutionCase('19', '23', true).result, 437);
  const rejected = toolExecutionCase('', '23', true);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.result, null);
  assert.match(rejected.reason, /缺少数字/);
  assert.match(toolFrames(true, false).find(frame => frame.phase === 'calculate')!.narration, /没有执行/);
});

test('two agent calls preserve both pieces of evidence but cannot claim the third-call summary', () => {
  const two = agentOutcome(2);
  const three = agentOutcome(3);
  assert.deepEqual(two.evidence, three.evidence);
  assert.equal(two.hasSearch, true);
  assert.equal(two.hasCalculation, true);
  assert.equal(two.hasSummary, false);
  assert.equal(two.summary, null);
  assert.equal(two.calls, 2);
  assert.equal(three.hasSummary, true);
  assert.match(three.summary!, /391/);
  assert.deepEqual(agentOutcome(5), three);
});

test('fixed sampling point remains inside the selected interval, with no new random draw', () => {
  const baseline = samplingCase(0.2);
  const changed = samplingCase(1.5);
  assert.equal(baseline.draw, 0.8);
  assert.equal(changed.draw, 0.8);
  assert.notDeepEqual(baseline.probabilities, changed.probabilities);
  assert.notEqual(baseline.word, changed.word);
  for (const item of [baseline, changed, samplingCase(0.3)]) {
    assert.ok(item.start <= item.draw && item.draw < item.end);
  }
  assert.equal(samplingCase(0.3).word, baseline.word, 'changed probabilities need not change this one outcome');
});

test('learning definitions map concepts honestly and keep branch frames out of the normal-route denominator', () => {
  assert.equal(LEARNING_PATH.length, 14);
  assert.equal(new Set(LEARNING_PATH.map(item => item.lessonId)).size, 14);
  assert.equal(getLearningPathItem('first-call')?.principleSceneId, 'api-call');
  assert.equal(getLearningPathItem('tokens')?.principleSceneId, 'sampling');
  assert.equal(getLearningPathItem('tokens')?.practiceAvailability, 'upcoming');
  assert.equal(getLearningPathItem('rag')?.principleSceneId, undefined);
  assert.equal(getLearningPathItem('rag')?.principleAvailability, 'upcoming');
  assert.deepEqual(PRINCIPLE_DEFINITIONS.map(item => item.requiredFrameIds.length), [4, 4, 5, 9, 4]);
  const agent = getPrincipleDefinition('agent')!;
  assert.ok(agent.allowedFrameIds.includes('stop:1'));
  assert.ok(!agent.requiredFrameIds.includes('stop:1'));
  assert.ok(agent.requiredFrameIds.includes('answer:3'));
  for (const definition of PRINCIPLE_DEFINITIONS) {
    assert.equal(new Set(definition.requiredFrameIds).size, definition.requiredFrameIds.length);
    assert.ok(definition.requiredFrameIds.every(id => definition.allowedFrameIds.includes(id)));
  }
});

test('changing temperature changes the distribution and outcome for the same random draw', () => {
  const concentrated = samplingDistribution(0.2);
  const diffuse = samplingDistribution(2);
  for (const probabilities of [concentrated, diffuse]) {
    assert.ok(probabilities.every(probability => probability > 0 && probability < 1));
    assert.ok(Math.abs(probabilities.reduce((sum, probability) => sum + probability, 0) - 1) < 1e-12);
    assert.equal(chooseCandidate(probabilities, 0), 0);
    assert.equal(chooseCandidate(probabilities, 0.999999), 3);
  }
  assert.ok(concentrated[0] > diffuse[0]);
  const fixedDraw = 0.8;
  assert.notEqual(chooseCandidate(concentrated, fixedDraw), chooseCandidate(diffuse, fixedDraw));
  assert.equal(chooseCandidate(concentrated, fixedDraw), chooseCandidate(samplingDistribution(0.2), fixedDraw));
});

test('taking out background removes that message and changes the teaching answer while preserving the question', () => {
  const included = contextPayload(true);
  const excluded = contextPayload(false);
  assert.equal(included.messages.length, excluded.messages.length + 1);
  assert.ok(included.messages.some(message => message.kind === 'history' && message.content.includes('做饭')));
  assert.ok(excluded.messages.every(message => !message.content.includes('做饭')));
  assert.deepEqual(included.messages.find(message => message.kind === 'question'), excluded.messages.find(message => message.kind === 'question'));
  assert.match(included.answer, /厨房/);
  assert.doesNotMatch(excluded.answer, /厨房/);
});

test('tool inputs affect real multiplication and invalid inputs never reach an execution frame', () => {
  assert.equal(validateOperands('17', '23').value, 391);
  assert.equal(validateOperands('19', '23').value, 437);
  assert.equal(validateOperands('-17', '23').value, -391);
  assert.equal(validateOperands('0', '23').value, 0);
  for (const [left, right] of [['', '23'], ['17', ' '], ['1.5', '23'], ['10000', '23'], ['NaN', '2']]) {
    const result = validateOperands(left, right);
    assert.equal(result.valid, false);
    assert.equal(result.value, null);
    assert.equal(toolFrames(result.valid).at(-1)?.phase, 'validate');
    assert.ok(toolFrames(result.valid).every(frame => frame.phase !== 'calculate' && frame.phase !== 'answer'));
  }
  assert.ok(toolFrames(validateOperands('19', '23').valid).some(frame => frame.phase === 'calculate'));
});

test('agent enforces model-call limits and distinguishes budget stop from task completion', () => {
  for (const limit of [1, 2]) {
    const frames = agentFrames(limit);
    assert.equal(frames.filter(frame => frame.phase === 'model').length, limit);
    assert.equal(frames.at(-1)?.phase, 'stop');
    assert.equal(frames.at(-1)?.memory?.length, limit);
    assert.ok(frames.every(frame => frame.phase !== 'answer'));
  }
  const allowedFive = agentFrames(5);
  assert.equal(allowedFive.filter(frame => frame.phase === 'model').length, 3);
  assert.equal(allowedFive.at(-1)?.phase, 'answer');
  assert.equal(allowedFive.at(-1)?.round, 3);
  assert.equal(allowedFive.at(-1)?.memory?.length, 2);
  const observations = allowedFive.filter(frame => frame.phase === 'observe');
  assert.equal(observations[0].memory?.length, 1);
  assert.equal(observations[1].memory?.length, 2);
});

test('return destinations preserve replay and map position without allowing foreign or unknown URLs', () => {
  const replay = '12e2233a-e4b0-4b2b-9c23-efea468286a8';
  assert.equal(theaterReturnPath(`/lab/tools?replay=${replay}&entry=story`), `/lab/tools?replay=${replay}&entry=story`);
  assert.equal(theaterReturnPath('/lab/agent-loop?replay=run-123-abc'), '/lab/agent-loop?replay=run-123-abc');
  assert.equal(theaterReturnPath('/explore?at=rag'), '/explore?at=rag');
  assert.equal(theaterReturnPath('/'), '/');
  assert.equal(theaterReturnPath('/lab/tools?entry=unknown&redirect=https://elsewhere.example'), '/lab/tools');
  assert.equal(theaterReturnPath('/lab/tools?replay=%3Cscript%3E'), '/lab/tools');
  for (const unsafe of ['https://elsewhere.example/lab/tools', '//elsewhere.example/lab/tools', '/\\elsewhere.example', '/admin', 'javascript:alert(1)', null]) {
    assert.equal(theaterReturnPath(unsafe), '/explore');
  }
});
