import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseWorkspaceCode, parseStoryPeople } from '../src/lib/workspace-entry';
import { getStoryStarter } from '../src/lib/tool-story';

test('story people accepts only whole counts 1..99, otherwise defaults to 17', () => {
  for (const [input, expected] of [[null,17],['1',1],['19',19],['99',99],['0',17],['100',17],['19.0',17],['19x',17],['-2',17],['',17]] as const) assert.equal(parseStoryPeople(input), expected);
});
test('an untouched or empty draft can continue the incoming story in every language', () => {
  for (const language of ['typescript','javascript','python'] as const) {
    const defaultCode = getStoryStarter(language,17);
    for (const draft of [undefined,'',defaultCode]) assert.equal(chooseWorkspaceCode({language,draft,defaultCode,storyPeople:19,replay:false}), getStoryStarter(language,19));
  }
});
test('custom drafts and replay always beat the story URL', () => {
  const defaultCode=getStoryStarter('typescript',17);
  assert.equal(chooseWorkspaceCode({language:'typescript',draft:'// my work\nlab.output(1)',defaultCode,storyPeople:19,replay:false}), '// my work\nlab.output(1)');
  assert.equal(chooseWorkspaceCode({language:'typescript',draft:defaultCode,defaultCode,storyPeople:19,replay:true}), defaultCode);
  assert.equal(chooseWorkspaceCode({language:'typescript',draft:defaultCode,defaultCode,storyPeople:null,replay:false}), defaultCode);
});
