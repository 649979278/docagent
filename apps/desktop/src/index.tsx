/**
 * React渲染进程入口
 * 挂载App组件到DOM
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到#root元素，无法挂载React应用');
}

const root = createRoot(container);
root.render(<App />);
