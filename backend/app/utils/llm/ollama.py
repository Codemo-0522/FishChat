from openai import OpenAI
from .base import ModelService
from .common import BaseModelService, MessageProcessor, ErrorHandler
import json
import logging
from typing import Dict, List, AsyncGenerator, Optional, Any

# 配置日志
logger = logging.getLogger(__name__)

class OllamaService(ModelService, BaseModelService):
    """Ollama服务"""
    def __init__(self, base_url: str, api_key: str, model_name: str):
        BaseModelService.__init__(self, base_url, api_key, model_name)
        
        # 初始化OpenAI客户端（指向Ollama服务器）
        self.client = OpenAI(
            base_url=f"{self.base_url}/v1",  # Ollama API地址
            api_key="ollama",  # 任意字符串即可
        )
    
    def get_model_specific_params(self) -> Dict[str, Any]:
        """获取Ollama特有的参数"""
        return {
            # Ollama使用标准OpenAI参数
            "temperature": 0.7,
            "max_tokens": 1024,
        }

    async def generate_stream(self, prompt: str, system_prompt: str, **kwargs) -> AsyncGenerator[str, None]:
        """生成流式响应 - 使用模板方法"""
        async for chunk in self.generate_stream_template(prompt, system_prompt, **kwargs):
            yield chunk

    async def _call_api(self, data: Dict[str, Any], **kwargs) -> AsyncGenerator[str, None]:
        """Ollama的API调用实现"""
        try:
            # 调用Ollama API（使用OpenAI兼容接口）
            stream = self.client.chat.completions.create(**data)
            
            # 处理流式响应
            for chunk in stream:
                if chunk.choices[0].delta.content is not None:
                    content = chunk.choices[0].delta.content
                    yield content

        except Exception as e:
            logger.error(f"Ollama API Error: {str(e)}")
            # 直接抛出异常，让模板方法统一处理
            raise e