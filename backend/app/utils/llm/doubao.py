from openai import OpenAI
from .base import ModelService
from .common import BaseModelService
import json
import logging
from typing import Dict, List, AsyncGenerator, Optional, Any
from ..minio_client import minio_client

# 配置日志
logger = logging.getLogger(__name__)

class DouBaoService(ModelService, BaseModelService):
    """豆包服务 - 使用模板方法模式"""
    def __init__(self, base_url: str, api_key: str, model_name: str):
        BaseModelService.__init__(self, base_url, api_key, model_name)
        self.last_saved_images = []  # 初始化保存的图片列表
        
        # 初始化OpenAI客户端
        self.client = OpenAI(
            base_url=self.base_url,
            api_key=self.api_key,
            default_headers={
                "User-Agent": "fish-chat/1.0"
            }
        )
    
    def get_model_specific_params(self) -> Dict[str, Any]:
        """获取豆包特有的参数（豆包API不支持某些参数）"""
        return {
            # 豆包API不支持 top_k, presence_penalty, frequency_penalty, repetition_penalty
            # 只使用基础参数
        }

    def _process_request_data(self, data: Dict[str, Any], images_base64: Optional[List[str]] = None, **kwargs) -> Dict[str, Any]:
        """豆包特定的请求数据处理 - 重写基类方法来处理图片"""
        if images_base64 and len(images_base64) > 0:
            # 豆包需要特殊的图片消息格式
            messages = data.get("messages", [])
            
            # 找到最后一条用户消息并添加图片
            for i in range(len(messages) - 1, -1, -1):
                if messages[i].get("role") == "user":
                    user_content = messages[i].get("content", "")
                    
                    # 构建包含图片的消息内容
                    message_content = []
                    
                    # 添加所有图片
                    for image_base64 in images_base64:
                        # 检测图片格式
                        image_prefix = image_base64[:12] if len(image_base64) >= 12 else image_base64
                        
                        if image_base64.startswith('/9j/') or image_base64.startswith('/9j'):
                            # JPEG格式 (JPEG文件通常以 /9j/ 开头的base64)
                            image_format = "jpeg"
                            image_url = f"data:image/jpeg;base64,{image_base64}"
                        elif image_base64.startswith('iVBORw0KGgo'):
                            # PNG格式 (PNG文件以 iVBORw0KGgo 开头的base64)
                            image_format = "png"
                            image_url = f"data:image/png;base64,{image_base64}"
                        elif image_base64.startswith('R0lGODlh') or image_base64.startswith('R0lGODdh'):
                            # GIF格式
                            image_format = "gif"
                            image_url = f"data:image/gif;base64,{image_base64}"
                        else:
                            # 默认使用JPEG (因为压缩器输出JPEG)
                            image_format = "jpeg"
                            image_url = f"data:image/jpeg;base64,{image_base64}"
                            
                        logger.info(f"检测到图片格式: {image_format}, Base64前缀: {image_prefix}")
                            
                        message_content.append({
                            "type": "image_url",
                            "image_url": {
                                "url": image_url
                            }
                        })
                    
                    # 添加文本内容
                    if user_content.strip():
                        message_content.append({
                            "type": "text",
                            "text": user_content
                        })
                    
                    # 更新消息格式
                    messages[i]["content"] = message_content
                    logger.info(f"为豆包API转换图片消息格式: {len(images_base64)}张图片")
                    break
            
            data["messages"] = messages
        
        return data

    async def generate_stream(self, prompt: str, system_prompt: str, **kwargs) -> AsyncGenerator[str, None]:
        """🎯 实现抽象方法 - 使用模板方法"""
        async for chunk in self.generate_stream_template(prompt, system_prompt, **kwargs):
            yield chunk

    async def _call_api(self, data: Dict[str, Any], **kwargs) -> AsyncGenerator[str, None]:
        """🚀 豆包的API调用实现（唯一需要差异化的部分）"""
        try:
            logger.info(f"📡 调用豆包API: {self.base_url}/chat/completions")
            logger.info(f"🏷️ 模型: {data['model']}")
            
            # 提取参数用于后续的图片保存
            images_base64 = kwargs.get("images_base64")
            session_id = kwargs.get("session_id")
            message_id = kwargs.get("message_id")
            user_id = kwargs.get("user_id")  # 新增用户ID参数
            
            try:
                # 发送流式请求
                stream = self.client.chat.completions.create(**data)

                # 处理流式响应
                full_response = ""
                for chunk in stream:
                    if chunk.choices[0].delta.content is not None:
                        content = chunk.choices[0].delta.content
                        full_response += content
                        yield content
                
                # 🖼️ 流式响应完成后，保存图片到MinIO
                await self._save_images_after_response(images_base64, session_id, message_id, user_id)
                    
            except Exception as e:
                logger.error(f"豆包流式请求失败: {str(e)}")
                # 尝试非流式请求作为备选
                logger.info("尝试非流式请求...")
                request_data = data.copy()
                request_data["stream"] = False
                response = self.client.chat.completions.create(**request_data)
                if response.choices[0].message.content:
                    full_response = response.choices[0].message.content
                    yield full_response
                    
                    # 🖼️ 非流式响应完成后，保存图片到MinIO
                    await self._save_images_after_response(images_base64, session_id, message_id, user_id)

        except Exception as e:
            logger.error(f"豆包 API Error: {str(e)}")
            # 使用统一的错误处理
            raise self.error_handler.handle_api_error(e)
    
    async def _save_images_after_response(self, images_base64: Optional[List[str]], session_id: Optional[str], message_id: Optional[str], user_id: Optional[str] = None):
        """响应完成后保存图片到MinIO"""
        logger.info(f"=== 检查是否需要保存图片到MinIO ===")
        logger.info(f"images_base64存在: {images_base64 is not None}")
        logger.info(f"user_id: {user_id}")
        logger.info(f"session_id存在: {session_id is not None}")
        logger.info(f"message_id存在: {message_id is not None}")
        
        if images_base64 and session_id and message_id:
            logger.info(f"✅ 开始保存{len(images_base64)}张图片到MinIO...")
            saved_images = await self._save_images_to_minio(images_base64, session_id, message_id, user_id)
            logger.info(f"✅ 图片保存结果: {saved_images}")
            
            # 将保存的图片URL存储到实例变量中，供外部访问
            self.last_saved_images = saved_images
        else:
            logger.warning("❌ 缺少必要参数，跳过图片保存")
            if not images_base64:
                logger.warning("  - images_base64为空")
            if not session_id:
                logger.warning("  - session_id为空")
            if not message_id:
                logger.warning("  - message_id为空")
    
    async def _save_images_to_minio(self, images_base64: List[str], session_id: str, message_id: str, user_id: Optional[str] = None):
        """保存图片到MinIO"""
        logger.info(f"=== 开始保存图片到MinIO ===")
        logger.info(f"user_id: {user_id}")
        logger.info(f"session_id: {session_id}")
        logger.info(f"message_id: {message_id}")
        logger.info(f"图片数量: {len(images_base64)}")
        
        try:
            saved_images = []
            for i, image_base64 in enumerate(images_base64):
                logger.info(f"正在保存第{i+1}张图片...")
                minio_url = minio_client.upload_image(image_base64, session_id, message_id, user_id)
                if minio_url:
                    saved_images.append(minio_url)
                    logger.info(f"✅ 图片已保存到MinIO: {minio_url}")
                else:
                    logger.error(f"❌ 第{i+1}张图片保存失败")
            
            if saved_images:
                logger.info(f"✅ 共保存了{len(saved_images)}张图片到MinIO")
                return saved_images
            else:
                logger.error("❌ 没有图片保存成功")
                return []
        except Exception as e:
            logger.error(f"❌ 保存图片到MinIO失败: {e}")
            import traceback
            logger.error(f"详细错误信息: {traceback.format_exc()}")
        return []
