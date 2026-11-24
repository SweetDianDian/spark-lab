import assert from 'node:assert/strict';
import test from 'node:test';
import { getStoryStarter } from '../src/lib/tool-story';
import { runTool, simulateModel } from '../src/runtime/core';
import { executeJavascript } from '../src/runtime/execution';

for (const language of ['javascript', 'typescript'] as const) {
  test(`${language} fee experiment passes the chosen headcount through the model, tool and output`, async () => {
    for (const people of [1, 17, 19, 99]) {
      const events: unknown[] = [];
      await executeJavascript(getStoryStarter(language, people), language, {
        step: (_node, _title, data) => events.push(['input', (data as { people: number }).people]),
        log: () => {},
        model: async request => {
          const response = simulateModel(request);
          events.push(['request', response.toolCalls[0]?.arguments.expression]);
          return response;
        },
        tool: async (name, args) => {
          const data = runTool(name, args);
          events.push(['tool', name, data.result]);
          return data;
        },
        output: data => events.push(['output', data]),
      });
      const expression = `${people} * 23`;
      assert.deepEqual(events, [
        ['input', people], ['request', expression], ['tool', 'calculator', people * 23],
        ['output', { expression, result: people * 23 }],
      ]);
    }
  });
}
