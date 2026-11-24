import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueReturn, chapterPath, practiceAfterComparison } from '../src/lib/chapter-navigation';
import { theaterReturnPath } from '../src/data/theater';

function fromCatalogue(origin: string, extra: Record<string, string> = {}) {
  return '?' + new URLSearchParams({ ...extra, returnTo: origin });
}

test('catalogue return retains relations with or without a chapter in either parameter order', () => {
  for (const [origin, expected] of [
    ['/explore?view=relations', '/explore?view=relations'],
    ['/explore?view=relations&at=tools', '/explore?view=relations&at=tools'],
    ['/explore?at=tools&view=relations', '/explore?view=relations&at=tools'],
    ['/explore?at=tools', '/explore?at=tools'],
    ['/explore', '/explore'],
    ['/', '/'],
  ]) {
    assert.equal(catalogueReturn(fromCatalogue(origin), 'context'), expected);
  }
});

test('relations survives learn/lab switches, different chapters, and a deep demonstration round trip', () => {
  for (const origin of ['/explore?view=relations', '/explore?view=relations&at=tools', '/explore?at=tools&view=relations']) {
    const expectedOrigin = catalogueReturn(fromCatalogue(origin), 'tools');
    const source = fromCatalogue(origin, { replay: 'run-12', frame: 'execute', entry: 'story', people: '19' });
    const learn = chapterPath('learn', 'tools', source, true);
    const lab = chapterPath('lab', 'tools', learn.slice(learn.indexOf('?')), true);
    assert.equal(catalogueReturn(lab.slice(lab.indexOf('?')), 'tools'), expectedOrigin);
    const labParams = new URLSearchParams(lab.slice(lab.indexOf('?')));
    assert.equal(labParams.get('replay'), 'run-12');
    assert.equal(labParams.get('frame'), 'execute');
    assert.equal(labParams.get('people'), '19');

    const deepReturn = theaterReturnPath(learn);
    assert.equal(catalogueReturn(deepReturn.slice(deepReturn.indexOf('?')), 'tools'), expectedOrigin);
    const backToPractice = practiceAfterComparison('tools', deepReturn);
    assert.ok(backToPractice.startsWith('/lab/tools?'));
    assert.equal(new URLSearchParams(backToPractice.slice(backToPractice.indexOf('?'))).get('replay'), 'run-12');
    assert.equal(catalogueReturn(backToPractice.slice(backToPractice.indexOf('?')), 'tools'), expectedOrigin);

    for (const next of [chapterPath('learn', 'context', source), practiceAfterComparison('context', deepReturn)]) {
      const params = new URLSearchParams(next.slice(next.indexOf('?')));
      assert.deepEqual([...params], [['returnTo', expectedOrigin]], 'chapter-specific replay/frame/story must not leak into another chapter');
    }
    assert.equal(new URLSearchParams(practiceAfterComparison('tools', origin).split('?')[1]).get('returnTo'), expectedOrigin);
  }
});

test('chapter paths whitelist catalogue state during same-chapter switches as well as chapter changes', () => {
  for (const sameChapter of [true, false]) {
    const path = chapterPath('lab', 'tools', fromCatalogue('/explore?at=tools&view=relations&redirect=https://elsewhere.example#unsafe'), sameChapter);
    assert.equal(new URLSearchParams(path.split('?')[1]).get('returnTo'), '/explore?view=relations&at=tools');
    const external = chapterPath('learn', 'tools', fromCatalogue('//elsewhere.example/explore?view=relations'), sameChapter);
    assert.equal(new URLSearchParams(external.split('?')[1]).get('returnTo'), '/explore?at=tools');
  }
  assert.equal(catalogueReturn(fromCatalogue('/explore?view=unknown&at=tools'), 'context'), '/explore?at=tools');
  assert.equal(catalogueReturn(fromCatalogue('/explore?view=relations&at=not-a-chapter'), 'context'), '/explore?view=relations');
  assert.equal(catalogueReturn(fromCatalogue('/explore?at=not-a-chapter'), 'context'), '/explore?at=context');
  assert.equal(catalogueReturn('', 'context'), '/explore?at=context');
});
