import os
from pydantic_settings import BaseSettings
import logging
from typing import Optional

# 日志静默开关（生产或显式开启时全局禁用日志）
_SILENCE_LOGS = (
	os.getenv("SILENCE_BACKEND_LOGS", "").strip() in {"1", "true", "True"}
	or os.getenv("ENV", "").lower() == "production"
)
if _SILENCE_LOGS:
	# 禁用所有级别<=CRITICAL的日志（基本等于全关）
	logging.disable(logging.CRITICAL)
else:
	# 配置日志（非静默环境维持原INFO级别）
	logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)

class Settings(BaseSettings):
	# 服务器设置
	server_host: str = os.getenv("SERVER_HOST", "")  # 服务器主机地址
	server_port: int = int(os.getenv("SERVER_PORT", 8000))  # 服务器端口

	# JWT设置
	jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "")
	jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "")
	access_token_expire_minutes: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

	# 数据库索引设置
	skip_index_check: bool = os.getenv("SKIP_INDEX_CHECK", "false").lower() == "true"  # 跳过索引检查
	
	# MongoDB设置
	mongodb_url: str = os.getenv("MONGODB_URL", "")
	mongodb_db_name: str = os.getenv("MONGODB_DB_NAME", "")

	# MinIO设置
	minio_endpoint: str = os.getenv("MINIO_ENDPOINT", "")
	minio_access_key: str = os.getenv("MINIO_ACCESS_KEY", "")
	minio_secret_key: str = os.getenv("MINIO_SECRET_KEY", "")
	minio_bucket_name: str = os.getenv("MINIO_BUCKET_NAME", "fish-chat")
	#TTS默认服务商
	tts_service:str=os.getenv("TTS_SERVICE", "")

	# TTS设置
	tts_app_id: str = os.getenv("TTS_APP_ID", "")
	tts_api_key: str = os.getenv("TTS_API_KEY", "")
	tts_api_secret: str = os.getenv("TTS_API_SECRET", "")

	# 字节跳动TTS设置
	bytedance_tts_appid: str = os.getenv("BYTE_DANCE_TTS_APPID", "")
	bytedance_tts_token: str = os.getenv("BYTE_DANCE_TTS_TOKEN", "")
	bytedance_cluster: str = os.getenv("BYTE_DANCE_TTS_CLUSTER", "")

	# DeepSeek设置
	deepseek_base_url: str = os.getenv("DEEPSEEK_BASE_URL", "")
	deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "")
	default_model: str = os.getenv("DEFAULT_MODEL", "")

	# 豆包设置
	doubao_base_url: str = os.getenv("DOUBAO_BASE_URL", "")
	doubao_api_key: str = os.getenv("DOUBAO_API_KEY", "")
	doubao_default_model: str = os.getenv("DOUBAO_DEFAULT_MODEL", "")

	# RAGFlow 配置
	RAGFLOW_BASE_URL: str = os.getenv("RAGFLOW_BASE_URL", "http://117.50.181.92:9380")
	RAGFLOW_API_KEY: Optional[str] = os.getenv("RAGFLOW_API_KEY", "")

	# 邮箱验证配置
	email_verification: bool = os.getenv("EMAIL_VERIFICATION", "0") == "1"
	
	# SMTP邮件服务配置
	smtp_server: str = os.getenv("SMTP_SERVER", "")
	smtp_port: int = int(os.getenv("SMTP_PORT", ""))
	smtp_user: str = os.getenv("SMTP_USER", "")
	smtp_pass: str = os.getenv("SMTP_PASS", "")
	smtp_use_ssl: bool = os.getenv("SMTP_USE_SSL", "1") == "1"
	
	# 验证码配置
	verification_code_expire_minutes: int = int(os.getenv("VERIFICATION_CODE_EXPIRE_MINUTES", "5"))
	verification_code_length: int = int(os.getenv("VERIFICATION_CODE_LENGTH", "6"))
	
	# 应用配置
	app_name: str = os.getenv("APP_NAME", "FishChat")
	app_url: str = os.getenv("APP_URL", "")

# 创建settings实例并导出
logger.info("正在加载配置...")
logger.info(f"当前工作目录: {os.getcwd()}")

#创建.env环境变量对象 
settings = Settings()  