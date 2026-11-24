import type { RunEvent } from '../types';

function inputFields(events: RunEvent[]) {
  const value = events.find(event => event.type === 'step' && event.nodeId === 'input')?.data;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function displayInput(value: unknown): string {
  if (value === undefined) return '未提供';
  if (typeof value === 'string') return '“' + value + '”';
  return JSON.stringify(value) ?? String(value);
}

/** Only compare fields actually recorded by both runs' input steps. */
export function describeInputChange(before: RunEvent[], after: RunEvent[]): string | undefined {
  const a = inputFields(before);
  const b = inputFields(after);
  if (!a || !b) return undefined;
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
  if (!fields.length) return '两次记录的输入字段相同';
  const changes = fields.slice(0, 2).map(key => {
    const oldValue = a[key], newValue = b[key];
    if (Array.isArray(oldValue) && Array.isArray(newValue) && oldValue.length !== newValue.length) {
      return key + ' 从 ' + oldValue.length + ' 项变为 ' + newValue.length + ' 项';
    }
    const shorten = (v: unknown) => { const text = displayInput(v); return text.length > 48 ? text.slice(0, 45) + '…' : text; };
    return key + '：' + shorten(oldValue) + ' → ' + shorten(newValue);
  });
  if (fields.length > 2) changes.push('另有 ' + (fields.length - 2) + ' 项变化');
  return changes.join('　');
}
