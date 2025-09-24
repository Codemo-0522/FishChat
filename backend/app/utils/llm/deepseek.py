from .base import ModelService
from .common import BaseModelService, MessageProcessor, ErrorHandler
import json
import logging
from typing import Dict, List, AsyncGenerator, Optional, Any
import aiohttp

# 配置日志
logger = logging.getLogger(__name__)

class DeepSeekService(ModelService, BaseModelService):
    """DeepSeek服务"""
    def __init__(self, base_url: str, api_key: str, model_name: str):
        BaseModelService.__init__(self, base_url, api_key, model_name)
    
    def get_model_specific_params(self) -> Dict[str, Any]:
        """获取DeepSeek特有的参数"""
        return {
            "top_k": 30,
            "presence_penalty": 0.3,
            "frequency_penalty": 0.2,
            "repetition_penalty": 1.2,
        }

    async def generate_stream(self, prompt: str, system_prompt: str, **kwargs) -> AsyncGenerator[str, None]:
        """生成流式响应（实现抽象方法）- 使用模板方法"""
        async for chunk in self.generate_stream_template(prompt, system_prompt, **kwargs):
            yield chunk

    async def _call_api(self, data: Dict[str, Any], **kwargs) -> AsyncGenerator[str, None]:
        """DeepSeek的API调用实现"""
        # 发送请求
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=data,
                timeout=aiohttp.ClientTimeout(total=120)
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"HTTP {response.status}: {error_text}")
                
                async for line in response.content:
                    if line:
                        line = line.decode('utf-8').strip()
                        if line.startswith('data: '):
                            json_str = line[6:]
                            if json_str == '[DONE]':
                                break
                            
                            try:
                                chunk = json.loads(json_str)
                                if 'choices' in chunk and chunk['choices']:
                                    delta = chunk['choices'][0].get('delta', {})
                                    if 'content' in delta:
                                        yield delta['content']
                            except json.JSONDecodeError:
                                continue

    async def generate_response(self, user_message: str, history: List[Dict[str, str]], 
                              system_prompt: str = None, images_base64: List[str] = None,
                              **kwargs) -> AsyncGenerator[str, None]:
        """生成响应（流式）- 保持向后兼容"""
        # 这个方法现在只是 generate_stream 的一个包装器，保持向后兼容
        async for chunk in self.generate_stream(
            prompt=user_message,
            system_prompt=system_prompt,
            history=history,
            images_base64=images_base64,
            **kwargs
        ):
            yield chunk