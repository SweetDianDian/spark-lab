import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Empty, Flex, Input, Menu, Result, Space, Spin, Tabs, Tag, Tooltip, Typography } from 'antd';
import { ApiOutlined, CodeOutlined, DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { lessons } from './data/lessons';
import { getLearningPathItem } from './data/learning-path';
import Dialog from './components/Dialog';
import Landing from './components/Landing';
import { deleteRun, getNote, getRuns, setNote } from './lib/storage';

import { lastChapterPath } from './lib/chapter-navigation';
const ChapterReader = lazy(() => import('./components/ChapterReader'));
const KnowledgeMap = lazy(() => import('./components/KnowledgeMap'));
const PrincipleTheater = lazy(() => import('./components/PrincipleTheater'));
const pageLayouts: Record<string, string> = { '/': 'landing', '/explore': 'catalogue', '/notebook': 'notebook', '/theater': 'theater' };

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [connection, setConnection] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const isLesson = /^\/(learn|lab)\//.test(location.pathname);
  const pagePath = location.pathname.replace(/\/+$/, '') || '/';
  const isTheater = pagePath === '/theater';
  const mainLayout = isLesson ? 'workspace' : pageLayouts[pagePath] ?? 'scroll';
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
    const lessonId = location.pathname.split('/').at(-1) ?? '';
    const title = location.pathname === '/' ? '看懂 AI，从真实执行开始' : location.pathname === '/explore' ? '课程路径' : location.pathname === '/theater' ? '原理演示' : isLesson ? getLearningPathItem(lessonId)?.title ?? '代码实验' : '学习记录';
    document.title = title + ' · Spark Lab';
  }, [location.pathname, isLesson]);
  return <div className="spark-app">
    <header className="lab-header">
      <Button type="text" className="lab-brand" onClick={() => navigate('/')} aria-label="Spark Lab 首页">
        <img src="/favicon.svg" alt="" width={32} height={32}/><strong>火花实验室</strong>
      </Button>
      <nav aria-label="主导航"><Menu mode="horizontal" selectedKeys={[isLesson ? '/continue' : location.pathname]} onClick={({ key }) => navigate(key)} items={[{ key: '/', label: '体验台' }, { key: '/explore', label: '课程路径' }, { key: '/continue', label: '继续学习' }, { key: '/notebook', label: '学习记录' }]}/></nav>
      <Button className="lab-connect" icon={<ApiOutlined/>} onClick={() => setConnection(true)}>API 连接</Button>
    </header>
    <main ref={mainRef} className={`lab-main lab-main-${mainLayout}`} aria-label={isLesson ? '章节学习区' : isTheater ? '原理学习工作区' : '页面内容'}>
      <Suspense fallback={<div className="lab-loading"><Spin description="正在打开学习内容" size="large"/></div>}>
        <Routes>
          <Route path="/" element={<Landing/>}/>
          <Route path="/explore" element={<KnowledgeMap/>}/>
          <Route path="/theater" element={<PrincipleTheater/>}/>
          <Route path="/continue" element={<Navigate to={lastChapterPath()} replace/>}/>
          <Route path="/learn/:lessonId" element={<ChapterReader mode="learn" onConnect={() => setConnection(true)}/>}/>
          <Route path="/lab/:lessonId" element={<ChapterReader mode="lab" onConnect={() => setConnection(true)}/>}/>
          <Route path="/notebook" element={<Notebook/>}/>
          <Route path="*" element={<Result className="lab-not-found" status="404" title="没有找到这一页" extra={<Button type="primary" onClick={() => navigate('/explore')}>返回课程路径</Button>}/>}/>
        </Routes>
      </Suspense>
    </main>
    {connection && <ConnectionDialog onClose={() => setConnection(false)}/>}
  </div>;
}

function Notebook() {
  const [runs, setRuns] = useState(() => { const value = getRuns(); return Array.isArray(value) ? value : []; });
  const [tab, setTab] = useState('runs');
  const [selected, setSelected] = useState(lessons[0].id);
  const [note, updateNote] = useState(() => getNote(lessons[0].id));
  const [saved, setSaved] = useState(true);
  const navigate = useNavigate();
  function pickNote(id: string) { setSelected(id); updateNote(getNote(id)); setSaved(true); }
  const runContent = runs.length ? <div className="records-grid">{runs.map(run => <Card key={run.id} size="small">
    <Flex gap={20} align="center" justify="space-between">
      <CodeOutlined style={{ fontSize: 22, color: '#4361ee' }}/>
      <Flex vertical gap={8} flex={1}>
        <Typography.Text strong>{getLearningPathItem(run.lessonId)?.title ?? run.title}</Typography.Text>
        <Space size={8} wrap><Typography.Text type="secondary">{new Date(run.savedAt).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</Typography.Text><Tag>{run.language}</Tag><Tag>{run.events.some(event => event.type === 'model.started') ? run.mode === 'live' ? '真实 API' : '教学模拟' : '本地执行'}</Tag><Typography.Text type="secondary">{run.events.length} 个事件</Typography.Text></Space>
      </Flex>
      <Tag color={run.status === 'failed' ? 'error' : run.status === 'completed' ? 'success' : 'default'}>{run.status === 'completed' ? '运行结束' : run.status === 'failed' ? '运行失败' : '已取消'}</Tag>
      <Button icon={<PlayCircleOutlined/>} onClick={() => navigate('/lab/' + run.lessonId + '?replay=' + encodeURIComponent(run.id))}>回放</Button>
      <Tooltip title="删除这条记录"><Button type="text" icon={<DeleteOutlined/>} aria-label={'删除' + run.title + '的运行记录'} onClick={() => { deleteRun(run.id); setRuns(getRuns()); }}/></Tooltip>
    </Flex>
  </Card>)}</div> : <Card className="records-empty"><Empty description={<Space orientation="vertical"><Typography.Text strong>还没有保存的实验</Typography.Text><Typography.Text type="secondary">完成一次实验后，保存当时的代码和执行记录，随时回来检查。</Typography.Text></Space>}><Button type="primary" onClick={() => navigate('/lab/first-call')}>打开第一个实验</Button></Empty></Card>;
  const noteContent = <div className="records-note-layout"><Card size="small"><Menu aria-label="选择笔记章节" selectedKeys={[selected]} onClick={({ key }) => pickNote(key)} items={lessons.filter(lesson => lesson.available).map(lesson => ({ key: lesson.id, label: lesson.number + ' · ' + (getLearningPathItem(lesson.id)?.title ?? lesson.title) }))}/></Card><Card>
    <Flex className="records-note-title" align="center" justify="space-between" gap={16}><Typography.Text strong>{getLearningPathItem(selected)?.title}</Typography.Text><Tag color={saved ? 'default' : 'error'} role="status">{saved ? '自动保存在此浏览器' : '保存失败，请复制笔记备份'}</Tag></Flex>
    <Input.TextArea aria-label="章节学习笔记" placeholder="用自己的话解释这一节的机制，记录代码修改和观察到的结果。" value={note} onChange={event => { updateNote(event.target.value); setSaved(setNote(selected, event.target.value)); }}/>
  </Card></div>;
  return <section className="records-page">
    <Flex className="records-heading" justify="space-between" align="center"><div><Typography.Title level={2}>学习记录</Typography.Title><Typography.Paragraph type="secondary">保存的代码、执行过程，以及你自己的理解。</Typography.Paragraph></div><Button onClick={() => navigate(lastChapterPath())}>继续学习</Button></Flex>
    <Tabs activeKey={tab} onChange={setTab} items={[{ key: 'runs', label: '实验回放 · ' + runs.length, children: runContent }, { key: 'notes', label: '章节笔记', children: noteContent }]}/>
    <Typography.Paragraph type="secondary" className="records-footnote">记录保存在当前浏览器。历史回放不会重新调用模型。</Typography.Paragraph>
  </section>;
}

function ConnectionDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<{ configured: boolean; model?: string; provider?: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/status', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('连接暂不可用'); return r.json(); }).then(setStatus).catch(e => { if (e.name !== 'AbortError') setError('暂时无法连接模型服务，教学模拟仍可正常使用。'); });
    return () => controller.abort();
  }, []);
  return <Dialog title="连接模型 API" onClose={onClose}><Flex vertical gap={20} className="api-connection-content">
    <Typography.Title level={4} style={{ margin: 0 }}>{status?.configured ? '模型连接已配置' : '配置你的模型服务'}</Typography.Title>
    <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{status?.configured ? '当前模型：' + status.model + '。在实验中切换到「真实 API」，首次请求将验证连接。' : '教学模式可以直接运行三种语言。连接模型后，同一份实验代码会发起真实 API 请求。'}</Typography.Paragraph>
    {error && <Alert type="warning" title={error} showIcon/>}
    {!status && !error && <Spin/>}
    {status && !status.configured && <Card size="small" title="为本地项目配置模型"><Flex vertical gap={14}>
      <Typography.Text>在项目的 .env 文件中设置下列变量，再重启开发服务。密钥只由服务端读取。</Typography.Text>
      <pre className="api-setup-code">{'AI_BASE_URL=https://api.deepseek.com/v1\nAI_MODEL=deepseek-chat\nAI_API_KEY=你的密钥'}</pre>
      <Typography.Text type="secondary">也支持 OpenAI 与通义千问兼容接口。真实请求使用你提供的 API 账户额度。</Typography.Text>
    </Flex></Card>}
    <Button type="primary" onClick={onClose} style={{ alignSelf: 'flex-end' }}>返回学习</Button>
  </Flex></Dialog>;
}
