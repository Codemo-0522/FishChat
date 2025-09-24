import os
import sys
import signal
import uvicorn
from dotenv import load_dotenv
from pathlib import Path
# 获取 run.py 所在目录的绝对路径
root_path = Path(__file__).parent
# 拼接 .env 文件路径，现在 .env 和 run.py 在同一目录下
env_path = root_path / ".env"  
load_dotenv(dotenv_path=env_path, encoding="utf-8")
# 静默开关（需尽早，优先于任何 print）
_silence = (
	os.getenv('SILENCE_BACKEND_LOGS', '').strip() in {'1', 'true', 'True'}
	or os.getenv('ENV', '').lower() == 'production'
)
# 在静默模式下，最早输出一条启动中信息到真实stdout
if _silence:
	try:
		sys.__stdout__.write("后端服务器启动中...\n")
		sys.__stdout__.flush()
	except Exception:
		pass
if _silence:
	# 可选：静默print，防止自定义print刷屏
	try:
		import builtins
		builtins.print = lambda *a, **k: None
	except Exception:
		pass

def signal_handler(sig, frame):
	print("\n正在优雅地关闭服务器...")
	sys.exit(0)


#获取服务器IP的动态设置IP=============================================================
import subprocess
import re

#获取服务器IP地址
def get_wlan_ipv4():
	"""获取无线局域网适配器WLAN的IPv4地址"""
	try:
		# 执行ipconfig命令，捕获输出（Windows系统默认编码为gbk）
		result = subprocess.run(
			['ipconfig'],
			stdout=subprocess.PIPE,
			stderr=subprocess.PIPE,
			text=False  # 先以字节形式获取，再手动解码
		)
		
		# 解码输出（Windows下ipconfig默认用gbk编码）
		output = result.stdout.decode('gbk', errors='replace')
		
		# 正则匹配：找到"无线局域网适配器 WLAN:"区块，再提取IPv4地址
		# 匹配逻辑：先定位到WLAN适配器区块，再在该区块内找IPv4地址行
		pattern = r'无线局域网适配器 WLAN:.*?IPv4 地址 .*?: (.*?)\r?\n'
		match = re.search(pattern, output, re.DOTALL)  # re.DOTALL让.匹配换行符
		
		if match:
			ipv4 = match.group(1).strip()
			return ipv4
		else:
			return "未找到无线局域网适配器WLAN的IPv4地址"
	
	except Exception as e:
		return f"获取失败：{str(e)}"

#修改.env文件
def modify_env_second_line(env_path, new_second_line):
	print("\n开始修改.env文件的服务器IP地址")
	"""
	只修改.env文件的第二行内容，其他行保持不变
	
	参数:
		env_path: .env文件路径
		new_second_line: 新的第二行内容（建议包含换行符\n，否则会与第三行内容粘连）
	"""
	# 确保新行以换行符结尾，避免与下一行粘连
	if not new_second_line.endswith('\n'):
		new_second_line += '\n'
	
	# 如果文件不存在，创建文件并写入两行（第一行为空）
	if not os.path.exists(env_path):
		return ".env文件不存在或者路径不正确"
	
	# 以读写模式打开文件
	with open(env_path, 'r+',encoding='utf-8') as f:
		# 读取第一行并保存（不修改）
		first_line = f.readline()
		
		# 读取第二行（仅用于移动指针，内容会被替换）
		f.readline()
		
		# 保存从第三行开始的所有内容
		remaining_content = f.read()
		
		# 将文件指针移回开头
		f.seek(0)
		
		# 写回第一行（保持原样）
		f.write(first_line)
		
		# 写入新的第二行
		f.write(new_second_line)
		
		# 写回剩余内容（第三行及以后，保持原样）
		f.write(remaining_content)
		
		# 截断可能多余的内容（如果新内容比原来短）
		f.truncate()
	return "服务器IP修改完成"
#======================================================================================

if __name__ == "__main__":
	#<动态设置服务器地址===========================================>
	#如果不需要自动获取服务器地址，则把这个标签内的调用删除掉
	wlan_ip = get_wlan_ipv4()
	print(f"\n服务器IP地址获取信息：{wlan_ip}")
	# 修改.env后端IP地址
	qd_ip=modify_env_second_line('.env', f'SERVER_HOST=http://{wlan_ip}')
	print("\n后端服务器IP地址修改："+qd_ip)
	# 修改.env前端IP地址
	hd_ip=modify_env_second_line('../frontend/.env', f'VITE_API_BASE_URL=http://{wlan_ip}:8000')
	print("\n前端服务器IP地址修改："+hd_ip)
	#</=============================================================>

	print("开始运行服务器OvO")
	# 注册信号处理器
	signal.signal(signal.SIGINT, signal_handler)
	signal.signal(signal.SIGTERM, signal_handler)

	uvicorn_kwargs = {
		"host": "0.0.0.0",
		"port": 8000,
		"reload": True,
		# 限制热重载监听范围，避免扫描体积很大的目录导致启动卡顿（Windows 上尤甚）
		"reload_dirs": ["backend/app"],
		"reload_excludes": [
			"backend/data",
			"temp",
			".git",
			"venv",
			"node_modules",
		],
	}
	if _silence:
		# 关闭uvicorn访问日志与大部分运行日志
		uvicorn_kwargs.update({
			"log_level": "critical",
			"access_log": False,
			"reload": False,
		})

	# 启动FastAPI应用
	uvicorn.run(
		"app.main:app",
		**uvicorn_kwargs
	) 