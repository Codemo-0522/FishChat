import json
import logging
from typing import Dict, List, Optional, Any, AsyncGenerator
from abc import abstractmethod

logger = logging.getLogger(__name__)

class MessageProcessor:
    """消息处理工具类"""
    
    def __init__(self):
        pass
    
    def prepare_system_message(self, system_prompt: str) -> Optional[Dict[str, str]]:
        """准备系统消息"""
        if system_prompt and system_prompt.strip():
            logger.info(f"\n=== 系统提示词 ===")
            logger.info(system_prompt)
            return {
                "role": "system",
                "content": system_prompt.strip()
            }
        return None
    
    def process_history_messages(self, history: List[Dict[str, str]], 
                               process_user_message=None, 
                               process_assistant_message=None) -> List[Dict[str, Any]]:
        """处理历史消息"""
        messages = []
        logger.info(f"\n=== 历史消息（最新{len(history)}条）===")
        
        for i in range(0, len(history)-1, 2):
            # 处理用户消息
            if i < len(history):
                msg = history[i]
                
                if process_user_message:
                    user_msg = process_user_message(msg)
                    if user_msg:
                        messages.append(user_msg)
                else:
                    # 默认处理 - 直接使用原始消息内容
                    messages.append({"role": "user", "content": msg['content']})
                    logger.info(f"[user]: {msg['content']}")

            # 处理助手消息
            if i+1 < len(history):
                msg = history[i+1]
                if process_assistant_message:
                    assistant_msg = process_assistant_message(msg)
                    if assistant_msg:
                        messages.append(assistant_msg)
                else:
                    # 默认处理
                    messages.append({"role": "assistant", "content": msg['content']})
                    logger.info(f"[assistant]: {msg['content']}")
        
        return messages

class ErrorHandler:
    """错误处理工具类"""
    
    @staticmethod
    def handle_api_error(error: Exception) -> Exception:
        """统一处理API错误"""
        error_msg = str(error)
        
        if "Model Not Exist" in error_msg or "model not found" in error_msg.lower():
            return Exception("模型不存在，请检查模型名称是否正确")
        elif "invalid_request_error" in error_msg or "invalid request" in error_msg.lower():
            return Exception("无效的请求，请检查API配置是否正确")
        elif "unauthorized" in error_msg.lower() or "401" in error_msg:
            return Exception("API密钥无效，请检查API密钥是否正确")
        elif "forbidden" in error_msg.lower() or "403" in error_msg:
            return Exception("API密钥权限不足，请检查API密钥权限")
        elif "not found" in error_msg.lower() or "404" in error_msg:
            return Exception("API端点不存在，请检查服务地址是否正确")
        elif "timeout" in error_msg.lower():
            return Exception("请求超时，请检查网络连接")
        else:
            return Exception(f"API调用失败: {error_msg}")

class BaseModelService:
    """模型服务基类，包含共同的功能"""
    
    def __init__(self, base_url: str, api_key: str, model_name: str):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.model_name = model_name
        self.message_processor = MessageProcessor()
        self.error_handler = ErrorHandler()
    
    def get_default_request_params(self) -> Dict[str, Any]:
        """获取默认的请求参数 - 子类可以重写此方法"""
        return {
            "stream": True,
            "temperature": 0.9,
            "top_p": 0.7,
            "max_tokens": 8192,
        }
    
    def get_model_specific_params(self) -> Dict[str, Any]:
        """获取模型特定的参数 - 子类可以重写此方法"""
        return {}
    
    def log_request_data(self, data: Dict[str, Any], service_name: str):
        """记录请求数据"""
        logger.info(f"\n=== 实际发送到 {service_name} API 的请求体 ===")
        logger.info(json.dumps(data, ensure_ascii=False, indent=2))
    
    def _prepare_messages(self, system_prompt: str, history: List[Dict[str, str]], 
                         user_message: str) -> List[Dict[str, str]]:
        """准备消息列表 - 通用实现"""
        messages = []
        
        # 添加系统消息
        system_msg = self.message_processor.prepare_system_message(system_prompt)
        if system_msg:
            messages.append(system_msg)
        
        # 处理历史消息
        if history:
            history_messages = self.message_processor.process_history_messages(history)
            messages.extend(history_messages)
        
        # 添加当前用户消息 - 直接使用原始消息内容
        messages.append({"role": "user", "content": user_message})
        logger.info(f"[user]: {user_message}")
        
        return messages
    
    async def generate_stream_template(self, prompt: str, system_prompt: str, **kwargs) -> AsyncGenerator[str, None]:
        """模板方法：通用的流式响应生成逻辑"""
        try:
            # 从kwargs中提取必要的参数
            history = kwargs.pop("history", [])
            images_base64 = kwargs.pop("images_base64", None)
            session_id = kwargs.pop("session_id", None)
            message_id = kwargs.pop("message_id", None)
            user_id = kwargs.pop("user_id", None)  # 新增用户ID参数
            model_params = kwargs.pop("model_params", None)
            
            logger.info(f"=== {self.__class__.__name__}服务参数检查 ===")
            logger.info(f"user_id: {user_id}")
            logger.info(f"session_id: {session_id}")
            logger.info(f"message_id: {message_id}")
            logger.info(f"prompt: {prompt}")
            logger.info(f"system_prompt: {system_prompt}")
            
            # 准备消息列表
            messages = self._prepare_messages(
                system_prompt=system_prompt,
                history=history,
                user_message=prompt
            )

            # 准备请求数据
            data = {
                "model": self.model_name,
                "messages": messages,
                **self.get_default_request_params(),
                **self.get_model_specific_params()
            }
            
            # 合并用户自定义模型参数（优先级最高）
            if isinstance(model_params, dict) and model_params:
                data.update(model_params)
                logger.info(f"应用自定义模型参数: {json.dumps(model_params, ensure_ascii=False)}")
            
            # 子类特定的数据处理（如果需要）
            data = self._process_request_data(data, images_base64, **kwargs)
            
            self.log_request_data(data, self.__class__.__name__.replace('Service', ''))
            
            # 将提取的参数重新添加到kwargs中，供_call_api使用
            kwargs["images_base64"] = images_base64
            kwargs["session_id"] = session_id
            kwargs["message_id"] = message_id
            kwargs["user_id"] = user_id
            
            # 调用子类实现的API调用方法
            async for chunk in self._call_api(data, **kwargs):
                yield chunk
                
        except Exception as e:
            error_msg = self.error_handler.handle_api_error(e)
            logger.error(f"{self.__class__.__name__}流式生成失败: {error_msg}")
            raise Exception(f"{self.__class__.__name__}流式生成失败: {error_msg}")
    
    def _process_request_data(self, data: Dict[str, Any], images_base64: Optional[List[str]] = None, **kwargs) -> Dict[str, Any]:
        """处理请求数据 - 子类可以重写此方法来添加特定处理"""
        return data
    
    @abstractmethod
    async def _call_api(self, data: Dict[str, Any], **kwargs) -> AsyncGenerator[str, None]:
        """调用API的抽象方法 - 子类必须实现此方法"""
        pass 