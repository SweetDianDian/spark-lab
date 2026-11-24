import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Flex, Space, Steps, Tag, Typography } from 'antd';
import { BookOutlined, CalculatorOutlined, CodeOutlined, PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import { LEARNING_PATH } from '../data/learning-path';
import { lessons } from '../data/lessons';
import { readLearningState } from '../lib/learning-state';
import type { RunEvent, RunResult } from '../types';
import './landing.css';

export default function Landing() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; controller.current?.abort(); }; }, []);
  const available = LEARNING_PATH.filter(item => item.practiceAvailability === 'available');
  const states = available.map(item => readLearningState(item.lessonId));
  const next = available.find((_, index) => !states[index].completionClaimed) ?? available[0];
  const nextState = readLearningState(next.lessonId);
  const hasStarted = states.some(state => state.practice.hasRun || state.completionClaimed || !!state.principle?.viewedCount);
  const destination = nextState.principle && !nextState.principle.completed ? `/theater?scene=${next.principleSceneId}&returnTo=%2Fexplore` : `/lab/${next.lessonId}`;
  const completedTools = events.filter(event => event.type === 'tool.completed');
  const search = completedTools.find(event => (event.data as {name?: string})?.name === 'search');
  const calculation = completedTools.find(event => (event.data as {name?: string})?.name === 'calculator');
  const calculationValue = (calculation?.data as {result?: {result?: number}} | undefined)?.result?.result;

  async function tryProject() {
    if (running) return;
    const ticket = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    setRunning(true); setResult(null); setEvents([]); setError('');
    try {
      const { runCode } = await import('../runtime');
      if (!mounted.current || ticket !== generation.current) return;
      const run = await runCode({ code: lessons.find(item => item.id === 'agent-loop')!.starter.javascript, language: 'javascript', mode: 'demo', lessonId: 'agent-loop', signal: abort.signal, onEvent: event => { if (mounted.current && ticket === generation.current) setEvents(value => [...value, event]); } });
      if (!mounted.current || ticket !== generation.current) return;
      setResult(run);
      if (run.status !== 'completed') setError(run.status === 'cancelled' ? '已停止。可以重新试运行。' : run.error ?? '这次运行未完成，请重试。');
    } catch (cause) {
      if (mounted.current && ticket === generation.current) setError(cause instanceof Error ? cause.message : '暂时无法启动实验，请重试。');
    } finally { if (mounted.current && ticket === generation.current) setRunning(false); }
  }

  return <section className="landing">
    <div className="landing-copy">
      <Tag color="blue">一个项目，逐步学会 LLM 与 Agent</Tag>
      <Typography.Title level={1} className="landing-title">亲手做一个<br/>能解释、会查证的 <span className="landing-assistant-name">AI 助手。</span></Typography.Title>
      <Typography.Paragraph type="secondary">先让它回答问题，再加入背景、工具和多步行动。<br/>每次只改一处，比较结果，把原理学明白。</Typography.Paragraph>
      <Space className="landing-actions" size="middle" wrap><Button type="primary" size="large" onClick={() => navigate(destination)}>{hasStarted ? `继续学习 · ${next.title}` : '开始第一节'}</Button><Button size="large" onClick={() => navigate('/explore')}>看看四节课怎样相连</Button></Space>
      <Space className="landing-languages" size="small"><CodeOutlined/><Typography.Text type="secondary">TypeScript · JavaScript · Python</Typography.Text></Space>
      <Typography.Paragraph type="secondary" className="landing-start-note">无需 API 密钥，也能先动手学习。</Typography.Paragraph>
    </div>
    <Card className="landing-project" title="你会亲手做出的能力" extra={<Tag color="blue">多步学习助手</Tag>}>
      <Flex vertical gap={22}>
        <div><Typography.Text type="secondary">交给助手一个任务</Typography.Text><Typography.Title level={4} className="landing-task-title">解释 RAG 是什么，计算 17 × 23，<br/>再用两句话总结。</Typography.Title></div>
        <div aria-live="polite"><Steps orientation="vertical" size="small" current={calculation ? 2 : search ? 1 : running ? 0 : -1} items={[
          { title: '先找到资料', icon: <BookOutlined/>, status: search ? 'finish' : running ? 'process' : 'wait', content: search ? '已从内置教学资料取回 RAG 解释' : '从教学资料中检索 RAG 的定义' },
          { title: '再执行计算', icon: <CalculatorOutlined/>, status: calculation ? 'finish' : search && running ? 'process' : 'wait', content: calculation ? `计算器实际返回：17 × 23 = ${calculationValue}` : '把计算交给程序，检查真实返回值' },
        ]}/></div>
        <div aria-live="polite"><Alert showIcon type={error ? result?.status === 'cancelled' ? 'warning' : 'error' : 'info'} title={result?.status === 'completed' ? '把两份结果组织成回答' : running ? '代码正在执行…' : '现在可以试运行这个教学示例'} description={result?.status === 'completed' ? String(result.output) : error || '从请求到工具结果，再到最终回答。四节课会带你逐步搭好这条链路。'}/></div>
        <Space wrap size="middle">{running ? <Button icon={<StopOutlined/>} onClick={() => controller.current?.abort()}>停止运行</Button> : <Button icon={<PlayCircleOutlined/>} onClick={() => void tryProject()}>{result ? '再运行一次' : '试运行教学示例'}</Button>}<Typography.Text type="secondary">{result?.status === 'completed' ? `${events.filter(event=>event.type==='model.completed').length} 次模型调用 · ${completedTools.length} 次工具执行` : '教学模型 · 工具实际执行'}</Typography.Text></Space>
      </Flex>
    </Card>
    <Card className="landing-method" title="每节课这样学"><Steps size="small" current={-1} responsive={false} items={['带着一个问题', '改变一个条件', '比较前后结果', '用代码验证'].map(title => ({ title }))}/></Card>
  </section>;
}
