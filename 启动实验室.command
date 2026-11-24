#!/bin/zsh -l
set -eu
cd -- "${0:A:h}"

print 'Spark Lab 本地服务'
print '访问地址：http://127.0.0.1:5190/'
print '请保留这个终端窗口。按 Control+C 停止服务。'
print ''

if ! command -v npm >/dev/null 2>&1; then
  print '未找到 npm。请安装 Node.js 后，在此目录运行 npm run dev。'
  read -r '?按回车退出。'
  exit 1
fi

if ! npm run dev; then
  print ''
  print '服务未启动。若上方提示端口已占用，请先尝试打开访问地址。'
  print '本项目固定使用 5190，不会自动切换到其他端口。'
  read -r '?按回车退出。'
  exit 1
fi
