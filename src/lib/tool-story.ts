import type { Language } from '../types';

/** Both the landing experiment and the editor execute this same program. */
export function getStoryStarter(language: Language, people: number): string {
  const count = Number.isInteger(people) && people >= 1 && people <= 99 ? people : 17;
  if (language === 'python') {
    return `people = ${count}
price = 23
question = f'每人 {price} 元。请用计算器计算 {people} * {price} 的总费用。'
lab.step('input', '准备费用问题', {'people': people, 'price': price, 'question': question})

response = await lab.model({'prompt': question, 'tools': ['calculator']})

if response['toolCalls']:
    for call in response['toolCalls']:
        result = await lab.tool(call['name'], call['arguments'])
        lab.output(result)
else:
    lab.output(response['text'])`;
  }
  return `const people${language === 'typescript' ? ': number' : ''} = ${count};
const price = 23;
const question = \`每人 \${price} 元。请用计算器计算 \${people} * \${price} 的总费用。\`;
lab.step('input', '准备费用问题', { people, price, question });

const response = await lab.model({ prompt: question, tools: ['calculator'] });

if (response.toolCalls.length > 0) {
  for (const call of response.toolCalls) {
    const result = await lab.tool(call.name, call.arguments);
    lab.output(result);
  }
} else {
  lab.output(response.text);
}`;
}
