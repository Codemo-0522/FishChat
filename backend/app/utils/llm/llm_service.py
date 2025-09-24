
import logging
from typing import Dict, Any, Optional, List, AsyncGenerator
from datetime import datetime, timezone, timedelta
# 移除向量相关导入
# import numpy as np
# from numpy.typing import NDArray
# from langchain_core.embeddings import Embeddings
# from sklearn.feature_extraction.text import TfidfVectorizer
# from ..vector_store.vector_store import VectorStore
# from ..content_filter import prepare_content_for_vector_storage, should_store_in_vector_db, prepare_content_for_context
from .deepseek import DeepSeekService
from .ollama import OllamaService
from .doubao import DouBaoService

# 配置日志
logger = logging.getLogger(__name__)

# 移除SimpleEmbeddings类和simple_tokenizer函数

class LLMService:
    """LLM服务管理类"""
    def __init__(self):
        # 移除向量存储初始化
        # self.vector_store = VectorStore()
        self.last_response = None
        self.last_saved_images = []  # 添加保存图片的属性
        # 移除 current_service 的缓存

    # 移除 _get_relevant_history 方法

    async def generate_stream(self, 
                             user_message: str, 
                             history: List[Dict[str, Any]], 
                             model_settings: Dict[str, Any],
                             system_prompt: Optional[str] = None,
                             session_id: Optional[str] = None,
                             **kwargs) -> AsyncGenerator[str, None]:
        """
        生成流式回复
        
        Args:
            user_message: 用户消息
            history: 历史对话记录
            model_settings: 模型配置
            system_prompt: 系统提示
            session_id: 会话ID
            **kwargs: 其他参数
            
        Yields:
            str: 生成的文本片段
        """
        
        try:
            # 解析模型配置
            model_service = model_settings.get("modelService", "deepseek")
            base_url = model_settings.get("baseUrl", "")
            api_key = model_settings.get("apiKey", "")
            model_name = model_settings.get("modelName", "")
            model_params = model_settings.get("modelParams") if isinstance(model_settings, dict) else None
            
            logger.info(f"生成流式回复")
            logger.info(f"用户消息: {user_message}")
            logger.info(f"会话ID: {session_id}")
            logger.info(f"使用模型服务: {model_service}")
            
            # 每次都创建新的服务实例，确保使用最新配置
            current_service = None
            if model_service == "deepseek":
                current_service = DeepSeekService(base_url, api_key, model_name)
            elif model_service == "ollama":
                current_service = OllamaService(base_url, api_key, model_name)
            elif model_service == "doubao":
                current_service = DouBaoService(base_url, api_key, model_name)
            else:
                raise ValueError(f"不支持的模型服务: {model_service}")
            
            # 生成回复，同时传递历史消息
            response_text = ""
            error_occurred = False
            saved_images = []
            
            try:
                # 传递历史消息
                extra_kwargs = {"history": history}
                
                # 如果有图片，传递多张图片base64数据
                if hasattr(current_service, 'generate_stream') and 'images_base64' in kwargs:
                    extra_kwargs["images_base64"] = kwargs.get("images_base64")
                    logger.info(f"传递图片数据: {len(kwargs.get('images_base64', []))}张图片")
                
                # 传递session_id和message_id参数
                if session_id:
                    extra_kwargs["session_id"] = session_id
                    logger.info(f"传递session_id: {session_id}")
                elif 'session_id' in kwargs:
                    extra_kwargs["session_id"] = kwargs.get("session_id")
                    logger.info(f"传递session_id: {kwargs.get('session_id')}")
                
                if 'message_id' in kwargs:
                    extra_kwargs["message_id"] = kwargs.get("message_id")
                    logger.info(f"传递message_id: {kwargs.get('message_id')}")
                
                # 传递user_id参数（用于MinIO路径隔离）
                if 'user_id' in kwargs:
                    extra_kwargs["user_id"] = kwargs.get("user_id")
                    logger.info(f"传递user_id: {kwargs.get('user_id')}")
                
                # 透传模型参数
                if model_params and isinstance(model_params, dict):
                    extra_kwargs["model_params"] = model_params
                    logger.info(f"透传模型参数: {list(model_params.keys())}")
                
                logger.info(f"最终传递给模型服务的参数: {list(extra_kwargs.keys())}")

                async for chunk in current_service.generate_stream(
                    user_message,  # 直接使用原始用户消息
                    system_prompt or "",
                    **extra_kwargs
                ):
                    if isinstance(chunk, str):
                        response_text += chunk
                        yield chunk
                    else:
                        logger.warning(f"收到非字符串的chunk: {type(chunk)}")
                
                self.last_response = {
                    "text": response_text,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                
                # 获取具体服务实例的保存图片信息
                if hasattr(current_service, 'last_saved_images'):
                    self.last_saved_images = current_service.last_saved_images
                    logger.info(f"✅ 从具体服务实例获取到保存的图片: {self.last_saved_images}")
                else:
                    self.last_saved_images = []
                    logger.info("具体服务实例没有last_saved_images属性")
                    
            except Exception as e:
                error_occurred = True
                logger.error(f"生成回复时发生错误: {str(e)}", exc_info=True)
                raise
            
        except Exception as e:
            logger.error(f"LLMService.generate_stream 发生错误: {str(e)}", exc_info=True)
            raise

    def get_last_response(self) -> Optional[str]:
        """获取最后一次的回复"""
        return self.last_response 