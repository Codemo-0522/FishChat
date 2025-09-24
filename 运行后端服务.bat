@echo off
:: 切换到backend目录（关键：确保脚本在backend目录下执行）
cd /d %~dp0backend

:: 执行run.py（此时工作目录是backend，相对路径会正确指向backend下的.env）
python run.py