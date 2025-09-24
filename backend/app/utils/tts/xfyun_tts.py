# -*- coding:utf-8 -*-
import websocket
import datetime
import hashlib
import base64
import hmac
import json
from urllib.parse import urlencode
import time
import ssl
from wsgiref.handlers import format_date_time
from datetime import datetime
from time import mktime
import _thread as thread
import os
import wave
import logging
from typing import Optional
import uuid
import asyncio
import websockets
import re
from typing import Optional, Dict, Any

# 配置日志
logger = logging.getLogger(__name__)

class Ws_Param(object):
    """语音合成Websocket参数类"""
    def __init__(self, appid, api_key, api_secret, text, outfile='./output.pcm',
                 vcn='x4_yezi', aue='raw', auf='audio/L16;rate=16000', tte='utf8'):
        self.appid = appid
        self.api_key = api_key
        self.api_secret = api_secret
        self.text = text
        self.outfile = outfile

        # 公共参数
        self.common_args = {"app_id": self.appid}
        # 业务参数
        self.business_args = {"aue": aue, "auf": auf, "vcn": vcn, "tte": tte}
        # 待合成文本数据
        self.data = {"status": 2, "text": str(base64.b64encode(self.text.encode('utf-8')), "UTF8")}

    def create_url(self):
        """生成带有鉴权信息的websocket连接URL"""
        url = 'wss://tts-api.xfyun.cn/v2/tts'
        
        # 生成RFC1123格式的时间戳
        now = datetime.now()
        date = format_date_time(mktime(now.timetuple()))
        
        # 拼接鉴权字符串
        signature_origin = "host: " + "ws-api.xfyun.cn" + "\n"
        signature_origin += "date: " + date + "\n"
        signature_origin += "GET " + "/v2/tts " + "HTTP/1.1"
        
        # 进行hmac-sha256加密
        signature_sha = hmac.new(
            self.api_secret.encode('utf-8'), 
            signature_origin.encode('utf-8'),
            digestmod=hashlib.sha256
        ).digest()
        signature_sha = base64.b64encode(signature_sha).decode(encoding='utf-8')
        
        # 构建Authorization参数
        authorization_origin = "api_key=\"%s\", algorithm=\"%s\", headers=\"%s\", signature=\"%s\"" % (
            self.api_key, "hmac-sha256", "host date request-line", signature_sha)
        authorization = base64.b64encode(authorization_origin.encode('utf-8')).decode(encoding='utf-8')
        
        # 构建完整URL
        v = {
            "authorization": authorization,
            "date": date,
            "host": "ws-api.xfyun.cn"
        }
        return url + '?' + urlencode(v)

def clean_text_for_tts(text: str) -> str:
    """
    清洗文本用于TTS生成。
    1. 移除英文括号和中文括号及其内容
    2. 保留引号内的内容
    3. 移除其他角色扮演相关的特殊标记
    4. 清理多余的空白字符
    """
    # 保存所有需要保留的引号内容
    quotes = {}
    quote_pattern = r'["""]([^"""]*)[""]'
    
    def save_quote(match):
        quote_id = f"QUOTE_{len(quotes)}"
        quotes[quote_id] = match.group(0)
        return quote_id
    
    # 暂时保存引号内容
    text = re.sub(quote_pattern, save_quote, text)
    
    # 移除英文括号和中文括号及其内容
    text = re.sub(r'\([^)]*\)', '', text)  # 移除英文圆括号及其内容
    text = re.sub(r'（[^）]*）', '', text)  # 移除中文圆括号及其内容
    text = re.sub(r'\[[^\]]*\]', '', text)  # 移除方括号及其内容
    text = re.sub(r'【[^】]*】', '', text)  # 移除中文方括号及其内容
    text = re.sub(r'\{[^}]*\}', '', text)  # 移除花括号及其内容
    text = re.sub(r'［[^］]*］', '', text)  # 移除中文方括号及其内容
    
    # 移除其他角色扮演相关的特殊标记
    text = re.sub(r'<[^>]*>', '', text)  # 移除XML样式的标签
    text = re.sub(r'\*[^*]*\*', '', text)  # 移除星号包围的内容
    
    # 恢复引号内容
    for quote_id, original_quote in quotes.items():
        text = text.replace(quote_id, original_quote)
    
    # 清理多余的空白字符
    text = re.sub(r'\s+', ' ', text)  # 将多个空白字符替换为单个空格
    text = re.sub(r'^\s+|\s+$', '', text)  # 移除首尾空白
    text = re.sub(r'\n\s*\n', '\n', text)  # 移除多余的空行
    
    return text.strip()

class XfyunTTSClient:
    """科大讯飞语音合成客户端"""
    def __init__(self, appid: str, api_key: str, api_secret: str):
        self.appid = appid
        self.api_key = api_key
        self.api_secret = api_secret
        self.pcm_file = None
        self.is_success = False

    def synthesize(self, text: str, outfile: str, vcn: str = 'x4_yezi') -> bool:
        """执行语音合成"""
        self.pcm_file = outfile
        self.is_success = False

        # 确保输出目录存在
        os.makedirs(os.path.dirname(os.path.abspath(outfile)), exist_ok=True)

        # 创建WebSocket参数
        ws_param = Ws_Param(
            appid=self.appid,
            api_key=self.api_key,
            api_secret=self.api_secret,
            text=text,
            outfile=outfile,
            vcn=vcn
        )

        # 创建WebSocket连接
        websocket.enableTrace(False)
        ws_url = ws_param.create_url()

        # 定义回调函数
        def on_message(ws, message):
            try:
                message = json.loads(message)
                code = message["code"]
                sid = message["sid"]

                if code != 0:
                    err_msg = message["message"]
                    logger.error(f"sid:{sid} 调用错误:{err_msg} 错误码:{code}")
                    ws.close()
                    return

                if "data" in message and "audio" in message["data"]:
                    audio = message["data"]["audio"]
                    audio = base64.b64decode(audio)
                    status = message["data"]["status"]

                    # 追加音频数据到文件
                    try:
                        with open(outfile, 'ab') as f:
                            f.write(audio)
                    except Exception as e:
                        logger.error(f"写入音频数据失败: {e}")
                        ws.close()
                        return

                    # 最后一帧时标记成功
                    if status == 2:
                        self.is_success = True
                        logger.info(f"合成完成，音频已保存至: {outfile}")
                        ws.close()

            except Exception as e:
                logger.error(f"接收消息解析异常: {e}")
                ws.close()

        def on_error(ws, error):
            logger.error(f"WebSocket错误: {error}")
            self.is_success = False

        def on_close(ws, close_status_code=None, close_msg=None):
            logger.info("WebSocket连接已关闭")

        def on_open(ws):
            def run(*args):
                try:
                    d = {
                        "common": ws_param.common_args,
                        "business": ws_param.business_args,
                        "data": ws_param.data,
                    }
                    d = json.dumps(d)
                    logger.info("------>开始发送文本数据")
                    ws.send(d)
                except Exception as e:
                    logger.error(f"发送数据失败: {e}")
                    ws.close()

            thread.start_new_thread(run, ())

        # 创建WebSocket应用并运行
        ws = websocket.WebSocketApp(
            ws_url,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close,
            on_open=on_open
        )
        ws.run_forever(sslopt={"cert_reqs": ssl.CERT_NONE})

        return self.is_success

def pcm_to_wav(pcm_file: str, wav_file: str, channels: int = 1, 
               sample_width: int = 2, sample_rate: int = 16000) -> bool:
    """将PCM文件转换为WAV文件"""
    try:
        logger.info(f"开始转换PCM到WAV - 输入: {pcm_file}, 输出: {wav_file}")
        
        # 检查输入文件
        if not os.path.exists(pcm_file):
            logger.error(f"错误: PCM文件不存在: {pcm_file}")
            return False
            
        pcm_size = os.path.getsize(pcm_file)
        if pcm_size == 0:
            logger.error("错误: PCM文件为空")
            return False
        
        # 读取PCM数据
        with open(pcm_file, 'rb') as pcm_f:
            pcm_data = pcm_f.read()
            logger.info(f"已读取PCM数据: {len(pcm_data)} 字节")
        
        # 创建WAV文件
        with wave.open(wav_file, 'wb') as wav_f:
            wav_f.setnchannels(channels)
            wav_f.setsampwidth(sample_width)
            wav_f.setframerate(sample_rate)
            wav_f.writeframes(pcm_data)
            logger.info(f"WAV文件写入完成: {wav_file}")
        
        # 验证输出文件
        if os.path.exists(wav_file):
            wav_size = os.path.getsize(wav_file)
            logger.info(f"WAV文件大小: {wav_size} 字节")
            return True
        else:
            logger.error("错误: WAV文件未能创建")
            return False
            
    except Exception as e:
        logger.error(f"PCM转WAV出错: {e}")
        return False

if __name__=="__main__":
    pass
