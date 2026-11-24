import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { learningTheme } from './ui-theme';
import 'antd/dist/reset.css';
import './styles.css';
import './learning-theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ConfigProvider locale={zhCN} theme={learningTheme}><AntdApp><BrowserRouter><App /></BrowserRouter></AntdApp></ConfigProvider></React.StrictMode>,
);
