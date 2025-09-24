import io
import base64
import uuid
from typing import List, Optional
from minio import Minio
from minio.error import S3Error
from ..config import settings
import logging

logger = logging.getLogger(__name__)

class MinioClient:
    def __init__(self):
        endpoint_raw = (settings.minio_endpoint or "").strip()
        if not endpoint_raw:
            logger.warning("未检测到 MINIO_ENDPOINT，MinIO 客户端未启用。")
            self.client = None
            self.bucket_name = (settings.minio_bucket_name or "").strip() or "fish-chat"
            return
        secure = endpoint_raw.startswith("https://")
        endpoint_clean = endpoint_raw.replace("http://", "").replace("https://", "")
        self.client = Minio(
            endpoint_clean,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=secure
        )
        self.bucket_name = settings.minio_bucket_name
        self._ensure_bucket_exists()
    
    def _is_configured(self) -> bool:
        if self.client is None:
            logger.error("MinIO 未配置（缺少 MINIO_ENDPOINT）。请求已跳过。")
            return False
        return True
    
    def _ensure_bucket_exists(self):
        """确保bucket存在，不存在则创建"""
        if self.client is None:
            return
        try:
            if not self.client.bucket_exists(self.bucket_name):
                self.client.make_bucket(self.bucket_name)
                logger.info(f"创建bucket: {self.bucket_name}")
        except S3Error as e:
            logger.error(f"MinIO bucket操作失败: {e}")
    
    def upload_image(self, image_base64: str, session_id: str, message_id: str, user_id: str = None) -> str:
        """上传图片到MinIO并返回对象路径"""
        logger.info(f"=== MinIO上传图片 ===")
        logger.info(f"user_id: {user_id}")
        logger.info(f"session_id: {session_id}")
        logger.info(f"message_id: {message_id}")
        logger.info(f"图片Base64长度: {len(image_base64)}")
        
        if not self._is_configured():
            return None
        
        try:
            # 生成唯一文件名
            file_id = str(uuid.uuid4())
            
            # 根据是否有用户ID生成不同的路径结构
            if user_id:
                # 新的路径结构：users/{user_id}/sessions/{session_id}/message_image/{file_id}.jpg
                # 传统会话的消息图片统一保存在message_image目录下，确保媒体资源完全隔离
                object_name = f"users/{user_id}/sessions/{session_id}/message_image/{file_id}.jpg"
                logger.info(f"🏷️ 使用用户隔离路径: {object_name}")
            else:
                # 兼容旧的路径结构（向后兼容）
                object_name = f"{session_id}/{message_id}/{file_id}.jpg"
                logger.warning(f"⚠️ 使用旧路径结构（缺少用户隔离）: {object_name}")
            
            logger.info(f"生成对象名称: {object_name}")
            
            # Base64转二进制
            if image_base64.startswith("data:image"):
                logger.info("检测到data:image格式，提取Base64数据")
                image_data = base64.b64decode(image_base64.split(',')[1])
            else:
                logger.info("直接使用Base64数据")
                image_data = base64.b64decode(image_base64)
            
            logger.info(f"图片二进制数据长度: {len(image_data)}字节")
            
            # 上传到MinIO
            logger.info(f"开始上传到MinIO，bucket: {self.bucket_name}")
            self.client.put_object(
                self.bucket_name,
                object_name,
                io.BytesIO(image_data),
                len(image_data),
                content_type="image/png"
            )
            
            minio_url = f"minio://{self.bucket_name}/{object_name}"
            logger.info(f"✅ 图片上传成功: {minio_url}")
            return minio_url
            
        except Exception as e:
            logger.error(f"❌ 图片上传失败: {e}")
            import traceback
            logger.error(f"详细错误信息: {traceback.format_exc()}")
            return None
    
    def get_image_base64(self, minio_url: str) -> Optional[str]:
        """从MinIO获取图片并转换为Base64"""
        if not self._is_configured():
            return None
        try:
            # 解析minio://bucket/object路径
            if minio_url.startswith("minio://"):
                path_parts = minio_url.replace("minio://", "").split("/", 1)
                if len(path_parts) == 2:
                    bucket, object_name = path_parts
                else:
                    logger.error(f"无效的MinIO URL格式: {minio_url}")
                    return None
            else:
                logger.error(f"无效的MinIO URL: {minio_url}")
                return None
            
            # 从MinIO下载图片
            response = self.client.get_object(bucket, object_name)
            image_data = response.read()
            
            # 转换为Base64
            base64_data = base64.b64encode(image_data).decode()
            return f"data:image/png;base64,{base64_data}"
            
        except Exception as e:
            logger.error(f"从MinIO获取图片失败: {e}")
            return None
    
    def delete_image(self, minio_url: str) -> bool:
        """删除MinIO中的图片"""
        if not self._is_configured():
            return False
        try:
            if minio_url.startswith("minio://"):
                path_parts = minio_url.replace("minio://", "").split("/", 1)
                if len(path_parts) == 2:
                    bucket, object_name = path_parts
                    self.client.remove_object(bucket, object_name)
                    logger.info(f"图片删除成功: {object_name}")
                    return True
            return False
        except Exception as e:
            logger.error(f"删除图片失败: {e}")
            return False
    
    def delete_session_folder(self, session_id: str) -> bool:
        """删除会话文件夹及其所有内容"""
        if not self._is_configured():
            return False
        try:
            logger.info(f"开始删除会话文件夹: {session_id}")
            
            # 列出会话文件夹下的所有对象
            objects = self.client.list_objects(
                self.bucket_name,
                prefix=f"{session_id}/",
                recursive=True
            )
            
            deleted_count = 0
            for obj in objects:
                try:
                    self.client.remove_object(self.bucket_name, obj.object_name)
                    logger.info(f"删除对象: {obj.object_name}")
                    deleted_count += 1
                except Exception as e:
                    logger.error(f"删除对象失败 {obj.object_name}: {e}")
            
            logger.info(f"✅ 会话文件夹删除完成，共删除 {deleted_count} 个对象")
            return True
            
        except Exception as e:
            logger.error(f"❌ 删除会话文件夹失败: {e}")
            import traceback
            logger.error(f"详细错误信息: {traceback.format_exc()}")
            return False

    def delete_prefix(self, prefix: str) -> bool:
        """根据前缀删除对象（等价于删除指定“文件夹”）。"""
        if not self._is_configured():
            return False
        try:
            logger.info(f"开始删除前缀: {prefix}")
            normalized_prefix = prefix if prefix.endswith('/') else f"{prefix}/"
            objects = self.client.list_objects(
                self.bucket_name,
                prefix=normalized_prefix,
                recursive=True
            )
            deleted_count = 0
            for obj in objects:
                try:
                    self.client.remove_object(self.bucket_name, obj.object_name)
                    logger.info(f"删除对象: {obj.object_name}")
                    deleted_count += 1
                except Exception as e:
                    logger.error(f"删除对象失败 {obj.object_name}: {e}")
            logger.info(f"✅ 前缀删除完成，共删除 {deleted_count} 个对象")
            return True
        except Exception as e:
            logger.error(f"❌ 删除前缀失败: {e}")
            import traceback
            logger.error(f"详细错误信息: {traceback.format_exc()}")
            return False

    def delete_assistant_across_owners(self, assistant_id: str) -> int:
        """扫描 users/ 下所有对象，定位包含 /assistants/{assistant_id}/ 的路径，并删除对应 owner 的助手根前缀。
        返回删除的 owner 数量（去重后）。"""
        if not self._is_configured():
            return 0
        try:
            owners_to_clean = set()
            prefix = "users/"
            # 全量扫描 users/，尽量避免遗漏（数量大时可能较慢）
            for obj in self.client.list_objects(self.bucket_name, prefix=prefix, recursive=True):
                name = obj.object_name
                marker = f"/assistants/{assistant_id}/"
                if marker in name:
                    # 期望路径：users/{owner}/assistants/{assistant_id}/...
                    parts = name.split('/')
                    # 简单健壮性判断
                    if len(parts) >= 4 and parts[0] == 'users':
                        owner_id = parts[1]
                        owners_to_clean.add(owner_id)
                        logger.debug(f"匹配到助手对象 owner={owner_id} path={name}")
            # 按 owner 删除
            for owner_id in owners_to_clean:
                owner_prefix = f"users/{owner_id}/assistants/{assistant_id}/"
                logger.info(f"🔍 跨owner清理助手前缀: {owner_prefix}")
                self.delete_prefix(owner_prefix)
            return len(owners_to_clean)
        except Exception as e:
            logger.error(f"跨owner清理助手失败 assistant_id={assistant_id}: {e}")
            return 0

# 创建全局MinIO客户端实例（容错：未配置时不会抛出异常）
minio_client = MinioClient() 