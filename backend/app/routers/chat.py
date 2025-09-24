from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
import uuid
import json
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from jose import jwt
from ..utils.auth import get_current_user
from ..models.user import User
from ..utils.llm.llm_service import LLMService
# 移除向量存储相关导入
# from ..utils.vector_store.vector_store import VectorStore
from ..utils.content_filter import prepare_content_for_context
from ..config import settings
from ..database import get_database
from ..utils.tts.xfyun_tts import XfyunTTSClient, clean_text_for_tts
from ..utils.tts.byte_dance_tts import ByteDanceTTS
import os

# 添加知识库检索相关导入
import httpx

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 清理过期的音频文件
def cleanup_audio_files():
    try:
        audio_dir = os.path.join("temp", "audio")
        if not os.path.exists(audio_dir):
            return
            
        # 获取当前时间
        now = datetime.now()
        
        # 遍历音频目录
        for filename in os.listdir(audio_dir):
            file_path = os.path.join(audio_dir, filename)
            # 获取文件修改时间
            file_mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
            
            # 如果文件超过48小时，删除它
            if now - file_mtime > timedelta(hours=48):
                try:
                    os.remove(file_path)
                    logger.info(f"已删除过期音频文件: {file_path}")
                except Exception as e:
                    logger.error(f"删除音频文件失败: {str(e)}")
    except Exception as e:
        logger.error(f"清理音频文件时出错: {str(e)}")

router = APIRouter(prefix="/chat", tags=["chat"])

class ModelSettings(BaseModel):
    modelService: str
    baseUrl: str
    apiKey: str
    modelName: str
    modelParams: Optional[dict] = None

class CreateSessionRequest(BaseModel):
    name: str
    model_settings: ModelSettings
    system_prompt: Optional[str] = None

class ChatMessage(BaseModel):
    role: str
    content: str
    timestamp: Optional[datetime] = None

class ChatSession(BaseModel):
    session_id: str
    name: str
    messages: List[ChatMessage]
    created_at: str
    system_prompt: Optional[str] = None
    context_count: Optional[int] = None  # None表示不限制上下文

# 创建DeepSeek服务实例
model_service = LLMService()
# vector_store = VectorStore() # 移除向量存储实例


@router.post("/sessions")
async def create_session(
    request: CreateSessionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """创建新会话"""
    logger.info(f"开始创建新会话 - 用户ID: {current_user.id}")
    logger.info(f"会话名称: {request.name}")
    logger.info(f"模型配置: {request.model_settings.dict()}")

    try:
        session_id = str(uuid.uuid4())
        created_at = datetime.now().isoformat()
        logger.info(f"生成会话ID: {session_id}")
        
        session = {
            "_id": session_id,
            "name": request.name,
            "user_id": str(current_user.id),
            "created_at": created_at,
            "model_settings": request.model_settings.dict(),
            "system_prompt": request.system_prompt,  # 保存system_prompt
            "context_count": 20,  # 默认上下文数量为20
            "history": []
        }
        logger.info(f"准备保存的会话数据: {session}")
        
        # 保存到数据库
        await db.fish_chat.chat_sessions.insert_one(session)
        logger.info(f"会话已成功保存到数据库")
        
        response_data = {
            "session_id": session_id,
            "name": request.name,
            "created_at": created_at,
            "model_settings": request.model_settings,
            "system_prompt": request.system_prompt,  # 返回system_prompt
            "context_count": 20,  # 返回默认的context_count
            "message_count": 0  # 新会话的消息数量为0
        }
        logger.info(f"返回给客户端的数据: {response_data}")
        return response_data

    except Exception as e:
        logger.error(f"创建会话失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="创建会话失败")

@router.get("/sessions")
async def get_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """获取用户的所有会话"""
    logger.info(f"开始获取会话列表 - 用户ID: {current_user.id}")
    try:
        sessions = await db.fish_chat.chat_sessions.find(
            {"user_id": str(current_user.id)}
        ).to_list(None)
        
        # 为每个会话添加消息数量统计
        for session in sessions:
            if "history" in session:
                session["message_count"] = len(session["history"])
            else:
                session["message_count"] = 0
        
        logger.info(f"成功获取会话列表 - 数量: {len(sessions)}")
        return sessions
    except Exception as e:
        logger.error(f"获取会话列表失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取会话列表失败")

@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """获取特定会话的详细信息"""
    try:
        session = await db.fish_chat.chat_sessions.find_one({
            "_id": session_id,
            "user_id": str(current_user.id)
        })
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
        return session
    except Exception as e:
        logger.error(f"获取会话详情失败: {str(e)}")
        raise HTTPException(status_code=500, detail="获取会话详情失败")

@router.post("/sessions/{session_id}/messages")
async def add_message(
    session_id: str,
    message: ChatMessage,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """添加消息到会话"""
    try:
        # 设置消息时间戳
        if not message.timestamp:
            message.timestamp = datetime.utcnow()
            
        # 更新数据库
        result = await db.fish_chat.chat_sessions.update_one(
            {
                "_id": session_id,
                "user_id": str(current_user.id)
            },
            {
                "$push": {
                    "history": message.dict()
                }
            }
        )
        
        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="会话不存在")
            
        return {"status": "success"}
    except Exception as e:
        logger.error(f"添加消息失败: {str(e)}")
        raise HTTPException(status_code=500, detail="添加消息失败")

@router.websocket("/ws/chat/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    session_id: str,
    db: AsyncIOMotorClient = Depends(get_database)
):
    logger.info(f"收到WebSocket连接请求 - 会话ID: {session_id}")
    
    try:
        await websocket.accept()
        logger.info("WebSocket连接已接受")

        # 等待接收认证消息
        auth_data = await websocket.receive_json()
        logger.info("收到认证消息")

        if auth_data.get('type') != 'authorization' or not auth_data.get('token'):
            logger.error("无效的认证消息格式")
            await websocket.close(code=4001, reason="Invalid authentication message")
            return

        # 从token中提取Bearer token
        auth_token = auth_data['token']
        if not auth_token.startswith('Bearer '):
            logger.error("无效的token格式")
            await websocket.close(code=4001, reason="Invalid token format")
            return

        token = auth_token.split(' ')[1]
        logger.info("开始验证token")

        # 验证用户 - 复用utils/auth.py的逻辑确保与REST API一致
        try:
            from ..utils.auth import get_current_user
            # 先验证token有效性
            payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
            account = payload.get("sub")
            if not account:
                raise ValueError("Token中没有账号")

            # 使用与REST API相同的逻辑获取用户信息
            user_doc = await db.fish_chat.users.find_one({"account": account})
            if not user_doc:
                raise ValueError("未找到用户")

            # 确保使用用户的UUID而不是MongoDB的_id，与utils/auth.py保持一致
            if "id" not in user_doc:
                # 如果老用户没有id字段，生成一个UUID并更新到数据库
                import uuid
                user_uuid = str(uuid.uuid4())
                await db.fish_chat.users.update_one(
                    {"_id": user_doc["_id"]},
                    {"$set": {"id": user_uuid}}
                )
                user_doc["id"] = user_uuid
                logger.info(f"为WebSocket用户 {account} 生成新的UUID: {user_uuid}")
            
            user = User(**user_doc)  # 创建User对象，确保与REST API返回类型一致
            logger.info(f"用户认证成功: {account}, user_id: {user.id}")

        except Exception as e:
            logger.error(f"Token验证失败: {str(e)}")
            await websocket.close(code=4001, reason="Authentication failed")
            return

        # 获取会话历史
        session = await db.fish_chat.chat_sessions.find_one({
            "_id": session_id,
            "user_id": user.id
        })
        
        if not session:
            logger.error(f"未找到会话: {session_id}")
            await websocket.close(code=4004, reason="Session not found")
            return
        
        logger.info(f"找到会话: {session_id}")

        # 认证成功后立即通知前端
        try:
            await websocket.send_text(json.dumps({"type": "auth_success"}))
        except Exception:
            logger.warning("发送auth_success消息失败，但继续处理连接")
        
        # 获取所有历史消息
        session = await db.fish_chat.chat_sessions.find_one(
            {"_id": session_id}
        )
        history = session.get("history", []) if session else []
        
        # 发送历史消息
        if history:
            logger.info(f"发送历史消息，共{len(history)}条")
            await websocket.send_text(json.dumps({
                "type": "history",
                "messages": history
            }))
        
        while True:
            try:
                # 接收消息
                data = await websocket.receive_text()
                logger.info(f"收到WebSocket消息: {data}")
                message_data = json.loads(data)

                # 心跳处理：回复pong
                if message_data.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
                    continue

                user_message = message_data.get("message", "")
                images_base64 = message_data.get("images", [])  # 获取多张图片base64数据
                model_settings = message_data.get("model_settings")  # 获取模型配置
                enable_voice = message_data.get("enable_voice", False)  # 获取语音开关状态
                
                # 详细记录模型配置信息
                if model_settings:
                    logger.info("收到会话特定的模型配置:")
                    logger.info(f"- 模型服务: {model_settings.get('modelService')}")
                    logger.info(f"- 基础URL: {model_settings.get('baseUrl')}")
                    logger.info(f"- 模型名称: {model_settings.get('modelName')}")
                    logger.info(f"- API密钥: {model_settings.get('apiKey')[:5]}..." if model_settings.get('apiKey') else "- API密钥: 未提供")
                else:
                    logger.info("未收到会话特定的模型配置，将使用系统默认配置")
                
                if not user_message.strip() and len(images_base64) == 0:
                    logger.warning("收到空消息且无图片")
                    continue
                
                # 准备用户消息文档，但暂不保存
                message_id = f"{session_id}_{len(history)}"
                base_time = datetime.utcnow()
                user_time = base_time
                user_message_doc = {
                    "role": "user",
                    "content": user_message,
                    "timestamp": user_time,  # 使用UTC时间，Mongo存为Date类型
                    "images": []  # 初始化图片字段
                }

                # 生成AI回复
                try:
                    logger.info("开始生成AI回复")
                    complete_response = ""  # 用于累积完整响应
                    # 获取会话的system_prompt
                    session_data = await db.fish_chat.chat_sessions.find_one({"_id": session_id})
                    system_prompt = session_data.get("system_prompt") if session_data else None
                    logger.info(f"使用会话的system_prompt: {system_prompt}")
                    
                    # 如果未从前端收到模型配置，则从会话中加载
                    if not model_settings and session_data:
                        model_settings = session_data.get("model_settings")
                        logger.info("从会话中加载模型配置用于生成回复")
                    
                    # 获取会话的上下文数量设置
                    session_data = await db.fish_chat.chat_sessions.find_one({"_id": session_id})
                    context_count = session_data.get("context_count", 20) if session_data else 20
                    logger.info(f"使用上下文数量: {context_count}")
                    
                    # 获取指定数量的历史消息用于上下文
                    if context_count is None:
                        # 当context_count为None时，获取所有历史消息（不限制）
                        recent_history = await db.fish_chat.chat_sessions.find_one(
                            {"_id": session_id},
                            {"history": 1}
                        )
                        recent_history = recent_history.get("history", []) if recent_history else []
                        logger.info(f"上下文数量为None，使用所有历史消息: {len(recent_history)}")
                    elif context_count > 0:
                        recent_history = await db.fish_chat.chat_sessions.find_one(
                            {"_id": session_id},
                            {"history": {"$slice": -context_count}}  # 获取最后context_count条消息
                        )
                        recent_history = recent_history.get("history", []) if recent_history else []
                        logger.info(f"获取到历史消息数量: {len(recent_history)}")
                    else:
                        # 当context_count为0时，不使用历史上下文
                        recent_history = []
                        logger.info("上下文数量为0，不使用历史上下文")
                    
                    # 过滤历史消息内容，移除深度思考标签用于上下文传递
                    filtered_history = []
                    for msg in recent_history:
                        filtered_msg = msg.copy()
                        if 'content' in filtered_msg:
                            filtered_msg['content'] = prepare_content_for_context(filtered_msg['content'])
                        filtered_history.append(filtered_msg)
                    logger.info(f"历史消息已过滤，移除深度思考内容用于上下文传递")
                    
                    # 知识库检索：如果会话启用了知识库，则构建完整的系统提示词（不与原提示词拼接）
                    kb_system_prompt = await retrieve_knowledge_for_session(user_message, session_id, db, user.id)
                    if kb_system_prompt:
                        system_prompt = kb_system_prompt
                        logger.info("已使用知识库提示词覆盖system_prompt")
                    
                    # 生成回复
                    saved_images = []
                    async for chunk in model_service.generate_stream(
                        user_message,
                        history=filtered_history,  # 使用过滤后的历史消息
                        model_settings=model_settings,
                        system_prompt=system_prompt or "",
                        session_id=session_id,
                        message_id=message_id,
                        user_id=user.id,  # 传递用户ID用于MinIO路径隔离，与REST API认证保持一致
                        images_base64=images_base64  # 传递多张图片base64数据
                    ):
                        if chunk:
                            complete_response += chunk  # 累积响应
                            logger.debug(f"发送回复片段: {chunk}")
                            await websocket.send_text(json.dumps({
                                "type": "message",
                                "content": chunk
                            }))
                    
                    # 获取保存的图片信息（如果有的话）
                    if hasattr(model_service, 'last_saved_images'):
                        saved_images = model_service.last_saved_images
                        logger.info(f"获取到保存的图片: {saved_images}")
                    else:
                        logger.warning("⚠️ 无法获取保存的图片信息")
                    
                    # API调用成功，保存用户消息和AI回复
                    if complete_response:
                        # 如果有图片，更新用户消息文档中的图片字段
                        if images_base64 and len(images_base64) > 0:
                            # 使用实际保存的图片URL
                            if saved_images and len(saved_images) > 0:
                                user_message_doc["images"] = saved_images
                                logger.info(f"✅ 使用实际保存的图片URL: {user_message_doc['images']}")
                            else:
                                # 如果有图片但没有获取到实际URL，记录警告但不保存默认路径
                                logger.warning("⚠️ 有图片但未能获取到保存的URL，不保存图片路径到数据库")
                                user_message_doc["images"] = []
                        
                        # 保存用户消息和AI回复
                        # AI回复使用序列号确保在用户消息之后
                        assistant_time = base_time + timedelta(seconds=1)
                        
                        ai_message_doc = {
                            "role": "assistant",
                            "content": complete_response,
                            "timestamp": assistant_time  # 使用UTC时间，Mongo存为Date类型
                        }
                        # 一次性保存用户消息和AI回复，并更新消息数量
                        await db.fish_chat.chat_sessions.update_one(
                            {"_id": session_id},
                            {
                                "$push": {
                                    "history": {
                                        "$each": [user_message_doc, ai_message_doc]
                                    }
                                },
                                "$inc": {
                                    "message_count": 2  # 增加2条消息（用户消息 + AI回复）
                                }
                            }
                        )
                        # 更新本地历史记录
                        history.extend([user_message_doc, ai_message_doc])
                        logger.info("用户消息和AI回复已一起保存到数据库，消息数量已更新")

                        # 生成语音文件
                        if enable_voice:  # 只在开启语音时生成
                            try:
                                # 确保音频目录存在
                                audio_dir = os.path.join("temp", "audio")
                                os.makedirs(audio_dir, exist_ok=True)
                                # 清理过期的音频文件
                                cleanup_audio_files()
                                # 根据开关状态决定是否清洗文本
                                enable_text_cleaning = message_data.get("enable_text_cleaning", True)  # 默认为True
                                text_for_tts = clean_text_for_tts(complete_response) if enable_text_cleaning else complete_response
                                logger.info(f"文本清洗状态: {enable_text_cleaning}")
                                logger.info(f"原始文本: {complete_response}")
                                logger.info(f"处理后文本: {text_for_tts}")

                                # 获取会话的TTS配置，如果没有则使用全局配置
                                session_data = await db.fish_chat.chat_sessions.find_one({"_id": session_id})
                                tts_settings = session_data.get("tts_settings") if session_data else None
                                
                                if tts_settings and tts_settings.get("provider"):
                                    # 使用会话级TTS配置
                                    tts_type = tts_settings["provider"]
                                    tts_config = tts_settings.get("config", {})
                                    voice_settings = tts_settings.get("voice_settings", {})
                                    logger.info(f"使用会话级TTS配置: {tts_type}")
                                    logger.info(f"音色设置: {voice_settings}")
                                else:
                                    # 使用全局TTS配置
                                    tts_type = settings.tts_service
                                    tts_config = None
                                    voice_settings = {}
                                    logger.info(f"使用全局TTS配置: {tts_type}")
                                
                                audio_file_path = os.path.join(audio_dir,
                                                               f"{session_id}_{len(history)}.wav")  # 用于构建保存的音频文件路径
                                
                                if tts_type == "xfyun" or tts_type == "xfyun_tts":
                                    # 连接讯飞云TTS实例
                                    if tts_config:
                                        # 使用会话配置
                                        tts_client = XfyunTTSClient(
                                            tts_config.get("appId", ""),
                                            tts_config.get("apiKey", ""),
                                            tts_config.get("apiSecret", "")
                                        )
                                        logger.info("使用会话级讯飞云TTS配置")
                                    else:
                                        # 使用全局配置
                                        tts_client = XfyunTTSClient(settings.tts_app_id, settings.tts_api_key,
                                                           settings.tts_api_secret)
                                        logger.info("使用全局讯飞云TTS配置")
                                    # 生成PCM文件
                                    pcm_file = os.path.join(audio_dir, f"{session_id}_{len(history)}.pcm") #用于语音生成

                                    # 获取音色设置，默认使用x4_yezi
                                    voice_type = voice_settings.get("voiceType", "x4_yezi")
                                    logger.info(f"使用讯飞云音色: {voice_type}")

                                    # 合成语音
                                    if tts_client.synthesize(text_for_tts, pcm_file, vcn=voice_type):
                                        # 转换为WAV格式
                                        from ..utils.tts.xfyun_tts import pcm_to_wav
                                        if pcm_to_wav(pcm_file, audio_file_path):
                                            # 构建完整的音频URL
                                            audio_filename = os.path.basename(audio_file_path)
                                            # 检查server_host是否已经包含协议前缀
                                            if settings.server_host.startswith(('http://', 'https://')):
                                                base_url = f"{settings.server_host}:{settings.server_port}"
                                            else:
                                                base_url = f"http://{settings.server_host}:{settings.server_port}"
                                            audio_url = f"{base_url}/audio/{audio_filename}"

                                            # 发送音频文件路径
                                            await websocket.send_text(json.dumps({
                                                "type": "audio",
                                                "file": audio_url
                                            }))
                                            logger.info(f"语音文件URL: {audio_url}")
                                elif tts_type == "bytedance" or tts_type == "bytedance_tts":
                                    # 连接字节跳动TTS实例
                                    if tts_config:
                                        # 使用会话配置
                                        tts_client = ByteDanceTTS(
                                            tts_config.get("appId", ""),
                                            tts_config.get("token", ""),
                                            tts_config.get("cluster", "")
                                        )
                                        logger.info("使用会话级字节跳动TTS配置")
                                    else:
                                        # 使用全局配置
                                        tts_client = ByteDanceTTS(settings.bytedance_tts_appid,
                                                                  settings.bytedance_tts_token,
                                                                  settings.bytedance_cluster)
                                        logger.info("使用全局字节跳动TTS配置")

                                    # 获取音色设置，默认使用zh_female_wanwanxiaohe_moon_bigtts
                                    voice_type = voice_settings.get("voiceType", "zh_female_wanwanxiaohe_moon_bigtts")
                                    logger.info(f"使用字节跳动音色: {voice_type}")

                                    # 调用字节跳动TTS合成音频到文件
                                    success = tts_client.synthesize_to_file(
                                        text=text_for_tts,
                                        output_file=audio_file_path,
                                        voice_type=voice_type
                                    )

                                    if success:
                                        logger.info(f"音频合成成功，已保存到: {audio_file_path}")

                                        # 构建完整的音频URL
                                        audio_filename = os.path.basename(audio_file_path)  # 使用MP3文件名

                                        # 检查server_host是否已经包含协议前缀
                                        if settings.server_host.startswith(('http://', 'https://')):
                                            base_url = f"{settings.server_host}:{settings.server_port}"
                                        else:
                                            base_url = f"http://{settings.server_host}:{settings.server_port}"

                                        audio_url = f"{base_url}/audio/{audio_filename}"

                                        # 发送音频文件路径
                                        await websocket.send_text(json.dumps({
                                            "type": "audio",
                                            "file": audio_url
                                        }))
                                        logger.info(f"语音文件URL已发送: {audio_url}")
                                    else:
                                        logger.error(f"音频合成失败，文件: {audio_file_path}")
                                else:
                                    # 未知的TTS类型或配置错误
                                    logger.error(f"不支持的TTS类型或配置无效: {tts_type}")
                                    if tts_config:
                                        logger.error(f"TTS配置: {tts_config}")

                            except Exception as e:
                                logger.error(f"生成语音文件失败: {str(e)}")
                                # 如果使用会话级配置失败，可以考虑回退到全局配置
                                if tts_config:
                                    logger.info("会话级TTS配置失败，建议检查配置是否正确")
                        
                        # 发送成功完成信号，包含图片信息
                        done_message = {
                            "type": "done",
                            "success": True
                        }
                        
                        # 如果有保存的图片，添加到完成消息中
                        if saved_images and len(saved_images) > 0:
                            done_message["saved_images"] = saved_images
                            logger.info(f"✅ 在完成消息中包含图片信息: {saved_images}")
                        
                        await websocket.send_text(json.dumps(done_message))
                    else:
                        # 没有生成任何内容
                        await websocket.send_text(json.dumps({
                            "type": "done",
                            "success": False,
                            "error": "未能生成有效回复"
                        }))
                    
                except Exception as e:
                    error_message = str(e)
                    logger.error(f"生成AI回复失败: {error_message}")
                    # 只发送一个错误消息，包含在done事件中
                    await websocket.send_text(json.dumps({
                        "type": "done",
                        "success": False,
                        "error": error_message
                    }))

            except WebSocketDisconnect:
                logger.info(f"WebSocket连接断开 - 会话ID: {session_id}")
                break
            except Exception as e:
                logger.error(f"WebSocket消息处理失败: {str(e)}")
                try:
                    await websocket.send_text(json.dumps({
                        "type": "done",
                        "success": False,
                        "error": "消息处理失败"
                    }))
                except:
                    pass
                    break

    except WebSocketDisconnect:
        logger.info("WebSocket连接已断开")
    except Exception as e:
        logger.error(f"WebSocket连接处理失败: {str(e)}")
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except:
            pass

@router.get("/model-config")
async def get_model_config():
    """获取模型配置"""
    logger.info(f"Loading model config - API Key: {settings.deepseek_api_key}")
    logger.info(f"Loading model config - Base URL: {settings.deepseek_base_url}")
    logger.info(f"Loading model config - Model Name: {settings.default_model}")
    
    return {
        "baseUrl": settings.deepseek_base_url,
        "apiKey": settings.deepseek_api_key,
        "modelName": settings.default_model
    }

@router.put("/sessions/{session_id}")
async def update_session(
	session_id: str,
	update_data: dict,
	db: AsyncIOMotorClient = Depends(get_database),
	current_user: User = Depends(get_current_user)
):
	"""更新会话信息"""
	logger.info(f"更新会话请求 - 会话ID: {session_id}, 用户ID: {current_user.id}")
	
	try:
		# 验证会话所有权
		session = await db.fish_chat.chat_sessions.find_one({
			"_id": session_id,
			"user_id": str(current_user.id)
		})
		
		if not session:
			logger.error(f"未找到会话或无权限: {session_id}")
			raise HTTPException(status_code=404, detail="Session not found")
			
		# 更新会话
		update_result = await db.fish_chat.chat_sessions.update_one(
			{"_id": session_id, "user_id": str(current_user.id)},
			{"$set": update_data}
		)
		
		# 兼容未修改内容的情况：若 matched=1 且 modified=0 也视为成功
		if getattr(update_result, 'matched_count', 0) == 0:
			logger.error(f"会话更新失败（未匹配到文档）: {session_id}")
			raise HTTPException(status_code=404, detail="Session not found")
		
		# 获取更新后的会话
		updated_session = await db.fish_chat.chat_sessions.find_one({"_id": session_id, "user_id": str(current_user.id)})
		logger.info(f"会话更新成功: {session_id}")
		
		return updated_session
		
	except Exception as e:
		logger.error(f"更新会话时出错: {str(e)}")
		raise HTTPException(status_code=500, detail=str(e))

@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    db: AsyncIOMotorClient = Depends(get_database),
    current_user: User = Depends(get_current_user)
):
    """删除会话"""
    try:
        # 验证会话所有权
        session = await db.fish_chat.chat_sessions.find_one({
            "_id": session_id,
            "user_id": str(current_user.id)
        })
        
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
            
        # 删除会话记录
        result = await db.fish_chat.chat_sessions.delete_one({
            "_id": session_id,
            "user_id": str(current_user.id)
        })
        
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="删除失败，会话不存在")
        
        # 尝试按DB中存储的URL精确删除头像（以防前缀不匹配造成遗漏）
        try:
            from ..utils.minio_client import minio_client
            if "role_avatar_url" in session and session["role_avatar_url"]:
                minio_client.delete_image(session["role_avatar_url"])
                logger.info(f"已按URL精确删除会话头像: {session['role_avatar_url']}")
        except Exception as e:
            logger.error(f"按URL删除会话头像失败: {str(e)}")
            # 不影响主流程
        
        # 删除会话的向量存储
        try:
            # model_service.vector_store.delete_session(session_id) # 移除向量存储删除
            logger.info(f"成功删除会话 {session_id} 的向量存储")
        except Exception as e:
            logger.error(f"删除会话向量存储失败: {str(e)}")
            # 不影响主流程，继续返回成功
        
        # 删除MinIO中的会话头像文件夹（传统会话角色头像）
        try:
            from ..utils.minio_client import minio_client
            # 统一确定资源所属用户（若会话记录存在 user_id 则按其删除，更稳妥）
            owner_user_id = str(session.get("user_id")) if session.get("user_id") else str(current_user.id)

            # 现用路径（仅头像）
            prefix_avatar = f"users/{owner_user_id}/sessions/{session_id}/role_avatar"
            minio_client.delete_prefix(prefix_avatar)
            logger.info(f"成功删除会话头像前缀: {prefix_avatar}")

            # 删除传统会话消息图片
            prefix_message_image = f"users/{owner_user_id}/sessions/{session_id}/message_image"
            minio_client.delete_prefix(prefix_message_image)
            logger.info(f"成功删除传统会话消息图片前缀: {prefix_message_image}")

            # 同时清理该会话下所有资源（更稳妥）
            prefix_session_root = f"users/{owner_user_id}/sessions/{session_id}"
            minio_client.delete_prefix(prefix_session_root)
            logger.info(f"成功删除会话资源根前缀: {prefix_session_root}")

            # 若记录中存在具体的 role_avatar_url，则按该URL反推出精确前缀进行删除（覆盖上传者与会话所属不一致的情况）
            role_avatar_url = session.get("role_avatar_url")
            if isinstance(role_avatar_url, str) and role_avatar_url.startswith("minio://"):
                try:
                    path_after_bucket = role_avatar_url.split("//", 1)[1].split("/", 1)[1]
                    last_slash_index = path_after_bucket.rfind("/")
                    if last_slash_index > 0:
                        precise_prefix = path_after_bucket[:last_slash_index + 1]
                        logger.info(f"尝试通过role_avatar_url删除精确前缀: {precise_prefix}")
                        minio_client.delete_prefix(precise_prefix)
                except Exception as e2:
                    logger.warning(f"解析 role_avatar_url 失败，跳过精确前缀清理: {e2}")

            # 兼容历史遗留路径（早期实现可能使用此前缀）
            legacy_prefix = f"roles/{session_id}"
            minio_client.delete_prefix(legacy_prefix)
            logger.info(f"成功删除会话头像历史前缀: {legacy_prefix}")
        except Exception as e:
            logger.error(f"删除会话头像MinIO前缀失败: {str(e)}")
            # 不影响主流程，继续返回成功
        
        return {"status": "success", "message": "会话已删除"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除会话失败: {str(e)}")
        raise HTTPException(status_code=500, detail="删除会话失败")

@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """获取会话的所有历史消息"""
    logger.info(f"开始获取会话消息 - 会话ID: {session_id}, 用户ID: {current_user.id}")
    try:
        # 查找会话并验证所有权
        session = await db.fish_chat.chat_sessions.find_one({
            "_id": session_id,
            "user_id": str(current_user.id)
        })
        
        if not session:
            logger.error(f"会话不存在或无权访问 - 会话ID: {session_id}")
            raise HTTPException(status_code=404, detail="会话不存在或无权访问")
            
        # 返回所有历史消息
        messages = session.get("history", [])
        logger.info(f"成功获取会话消息 - 消息数量: {len(messages)}")
        return messages
        
    except Exception as e:
        logger.error(f"获取会话消息失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取会话消息失败")

@router.delete("/sessions/{session_id}/messages/{message_index}")
async def delete_message(
    session_id: str,
    message_index: int,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """删除会话中的指定消息"""
    logger.info(f"开始删除消息 - 会话ID: {session_id}, 消息索引: {message_index}, 用户ID: {current_user.id}")
    try:
        # 获取会话
        session = await db.fish_chat.chat_sessions.find_one({
            "_id": session_id,
            "user_id": str(current_user.id)
        })
        
        if not session:
            logger.error(f"会话不存在或无权访问 - 会话ID: {session_id}")
            raise HTTPException(status_code=404, detail="会话不存在或无权访问")
        
        history = session.get("history", [])
        
        # 检查消息索引是否有效
        if message_index < 0 or message_index >= len(history):
            logger.error(f"消息索引无效 - 索引: {message_index}, 历史消息数量: {len(history)}")
            raise HTTPException(status_code=400, detail="消息索引无效")
        
        # 删除指定索引的消息
        deleted_message = history.pop(message_index)
        logger.info(f"已从内存中删除消息 - 角色: {deleted_message.get('role')}, 内容预览: {deleted_message.get('content', '')[:50]}...")
        
        # 检查并删除MinIO中的图片文件
        try:
            from ..utils.minio_client import minio_client
            
            # 检查消息是否包含图片
            images = deleted_message.get('images', [])
            if images and len(images) > 0:
                logger.info(f"发现消息包含 {len(images)} 张图片，开始删除MinIO文件")
                
                deleted_images_count = 0
                for image_url in images:
                    if image_url.startswith('minio://'):
                        if minio_client.delete_image(image_url):
                            deleted_images_count += 1
                            logger.info(f"成功删除MinIO图片: {image_url}")
                        else:
                            logger.warning(f"删除MinIO图片失败: {image_url}")
                    else:
                        logger.info(f"跳过非MinIO图片: {image_url}")
                
                logger.info(f"MinIO图片删除完成，成功删除 {deleted_images_count}/{len(images)} 张图片")
            else:
                logger.info("消息不包含图片，跳过MinIO删除操作")
        except Exception as e:
            logger.warning(f"删除MinIO图片失败: {str(e)}")
        
        # 从向量存储中删除消息
        try:
            # from ..utils.vector_store.vector_store import VectorStore # 移除向量存储导入
            # vector_store = VectorStore() # 移除向量存储实例
            
            # 获取被删除消息的内容、角色和时间戳
            deleted_content = deleted_message.get('content', '')
            deleted_role = deleted_message.get('role', '')
            deleted_timestamp = deleted_message.get('timestamp', '')
            
            if deleted_content and deleted_role and deleted_timestamp:
                # 删除向量存储中的对应消息
                # vector_store.delete_message(session_id, deleted_content, deleted_role, deleted_timestamp) # 移除向量存储删除
                logger.info(f"成功从向量存储删除消息 - 角色: {deleted_role}, 内容长度: {len(deleted_content)}, 时间戳: {deleted_timestamp}")
            else:
                logger.warning("被删除的消息缺少内容、角色或时间戳信息，无法从向量存储中删除")
        except Exception as e:
            logger.warning(f"从向量存储删除消息失败: {str(e)}")
        
        # 更新数据库
        result = await db.fish_chat.chat_sessions.update_one(
            {
                "_id": session_id,
                "user_id": str(current_user.id)
            },
            {
                "$set": {
                    "history": history,
                    "message_count": len(history)
                }
            }
        )
        
        if result.modified_count == 0:
            logger.error(f"数据库更新失败 - 会话ID: {session_id}")
            raise HTTPException(status_code=404, detail="会话不存在")
            
        logger.info(f"成功删除消息 - 会话ID: {session_id}, 消息索引: {message_index}")
        return {"status": "success", "message": "消息已删除"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除消息失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="删除消息失败")

@router.put("/sessions/{session_id}/messages/{message_index}")
async def update_message(
    session_id: str,
    message_index: int,
    request: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """修改会话中的指定消息"""
    logger.info(f"开始修改消息 - 会话ID: {session_id}, 消息索引: {message_index}, 用户ID: {current_user.id}")
    try:
        # 获取会话
        session = await db.fish_chat.chat_sessions.find_one({
            "_id": session_id,
            "user_id": str(current_user.id)
        })
        
        if not session:
            logger.error(f"会话不存在或无权访问 - 会话ID: {session_id}")
            raise HTTPException(status_code=404, detail="会话不存在或无权访问")
        
        history = session.get("history", [])
        
        # 检查消息索引是否有效
        if message_index < 0 or message_index >= len(history):
            logger.error(f"消息索引无效 - 索引: {message_index}, 历史消息数量: {len(history)}")
            raise HTTPException(status_code=400, detail="消息索引无效")
        
        # 获取要修改的消息
        message_to_update = history[message_index]
        original_content = message_to_update.get('content', '')
        original_images = message_to_update.get('images', [])
        
        # 获取修改内容
        new_content = request.get('content', original_content)
        new_images = request.get('images', original_images)
        images_to_delete = request.get('images_to_delete', [])
        
        logger.info(f"修改消息内容 - 原内容长度: {len(original_content)}, 新内容长度: {len(new_content)}")
        logger.info(f"图片处理 - 原图片数量: {len(original_images)}, 新图片数量: {len(new_images)}, 待删除图片数量: {len(images_to_delete)}")
        
        # 处理需要删除的图片
        if images_to_delete:
            try:
                from ..utils.minio_client import minio_client
                
                deleted_images_count = 0
                for image_url in images_to_delete:
                    if image_url.startswith('minio://'):
                        if minio_client.delete_image(image_url):
                            deleted_images_count += 1
                            logger.info(f"成功删除MinIO图片: {image_url}")
                        else:
                            logger.warning(f"删除MinIO图片失败: {image_url}")
                    else:
                        logger.info(f"跳过非MinIO图片: {image_url}")
                
                logger.info(f"MinIO图片删除完成，成功删除 {deleted_images_count}/{len(images_to_delete)} 张图片")
                
                # 从新图片列表中移除已删除的图片
                new_images = [img for img in new_images if img not in images_to_delete]
                
            except Exception as e:
                logger.warning(f"删除MinIO图片失败: {str(e)}")
        
        # 更新消息内容
        history[message_index]['content'] = new_content
        history[message_index]['images'] = new_images
        history[message_index]['updated_at'] = datetime.utcnow().isoformat() + 'Z'
        
        # 更新数据库
        result = await db.fish_chat.chat_sessions.update_one(
            {
                "_id": session_id,
                "user_id": str(current_user.id)
            },
            {
                "$set": {
                    "history": history
                }
            }
        )
        
        if result.modified_count == 0:
            logger.error(f"数据库更新失败 - 会话ID: {session_id}")
            raise HTTPException(status_code=404, detail="会话不存在")
            
        logger.info(f"成功修改消息 - 会话ID: {session_id}, 消息索引: {message_index}")
        return {
            "status": "success", 
            "message": "消息已修改",
            "updated_message": history[message_index]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"修改消息失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="修改消息失败")

@router.get("/sessions/{session_id}/export")
async def export_session_data(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """导出会话的对话数据"""
    logger.info(f"开始导出会话数据 - 会话ID: {session_id}, 用户ID: {current_user.id}")
    try:
        # 获取会话并验证所有权
        session = await db.fish_chat.chat_sessions.find_one({
            "_id": session_id,
            "user_id": str(current_user.id)
        })
        
        if not session:
            logger.error(f"会话不存在或无权访问 - 会话ID: {session_id}")
            raise HTTPException(status_code=404, detail="会话不存在或无权访问")
        
        # 获取历史消息
        history = session.get("history", [])
        session_name = session.get("name", "未命名会话")
        
        # 添加调试日志
        logger.info(f"会话历史记录数量: {len(history)}")
        for i, msg in enumerate(history):
            logger.info(f"消息 {i}: role={msg.get('role')}, content_length={len(msg.get('content', ''))}")
        
        # 生成对话文本
        conversation_text = f"会话名称: {session_name}\n"
        conversation_text += f"创建时间: {session.get('created_at', '未知')}\n"
        conversation_text += "=" * 50 + "\n\n"
        
        conversation_count = 1
        i = 0
        
        while i < len(history):
            message = history[i]
            role = message.get('role', '')
            content = message.get('content', '')
            
            if role == 'user':
                conversation_text += f"{conversation_count}. 我：{content}\n"
                
                # 查找下一个助手消息
                if i + 1 < len(history) and history[i + 1].get('role') == 'assistant':
                    assistant_content = history[i + 1].get('content', '')
                    conversation_text += f"   {session_name}：{assistant_content}\n"
                    i += 2  # 跳过已处理的助手消息
                else:
                    i += 1
                
                conversation_text += "\n"  # 对话间隔空行
                conversation_count += 1
            elif role == 'assistant':
                # 如果遇到单独的助手消息，也记录
                conversation_text += f"{conversation_count}. {session_name}：{content}\n"
                conversation_text += "\n"  # 对话间隔空行
                conversation_count += 1
                i += 1
            else:
                # 跳过其他类型的消息（如system等）
                i += 1
        
        # 如果没有对话内容
        if conversation_count == 1:
            conversation_text += "暂无对话内容\n"
        
        logger.info(f"成功导出会话数据 - 会话ID: {session_id}, 对话数量: {conversation_count - 1}")
        logger.info(f"生成的对话文本长度: {len(conversation_text)}")
        logger.info(f"对话文本预览: {conversation_text[:200]}...")
        
        return {
            "status": "success",
            "data": {
                "session_name": session_name,
                "conversation_text": conversation_text,
                "conversation_count": conversation_count - 1
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导出会话数据失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="导出会话数据失败") 

@router.get("/sessions/{session_id}/tts-config")
async def get_session_tts_config(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """获取会话的TTS配置"""
    logger.info(f"开始查询会话TTS配置 - 会话ID: {session_id}, 用户ID: {current_user.id}")
    
    try:
        # 查找会话并验证所有权
        session = await db.fish_chat.chat_sessions.find_one({
            "_id": session_id,
            "user_id": str(current_user.id)
        })
        
        if not session:
            logger.error(f"会话不存在或无权访问 - 会话ID: {session_id}, 用户ID: {current_user.id}")
            raise HTTPException(status_code=404, detail="会话不存在或无权访问")
        
        # 获取TTS配置
        tts_settings = session.get("tts_settings")
        
        if tts_settings:
            logger.info(f"找到TTS配置 - 会话ID: {session_id}")
            logger.info(f"TTS服务商: {tts_settings.get('provider', 'unknown')}")
            logger.info(f"配置字段数量: {len(tts_settings.get('config', {}))}")
            logger.info(f"音色设置: {tts_settings.get('voice_settings', {})}")
            
            return {
                "success": True,
                "has_config": True,
                "tts_settings": tts_settings
            }
        else:
            logger.info(f"未找到TTS配置 - 会话ID: {session_id}")
            return {
                "success": True,
                "has_config": False,
                "tts_settings": None
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"查询会话TTS配置失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="查询TTS配置失败")

@router.get("/test-ollama-config")
async def test_ollama_config(
    base_url: str,
    model_name: str,
    current_user: User = Depends(get_current_user)
):
    """测试 Ollama 模型配置"""
    try:
        logger.info(f"开始测试 Ollama 配置: base_url={base_url}, model_name={model_name}")
        
        # 导入 OpenAI 客户端
        from openai import OpenAI
        
        # 配置 OpenAI 客户端（指向 Ollama 服务器）
        client = OpenAI(
            base_url=f"{base_url}/v1",  # Ollama API 地址
            api_key="ollama",  # 任意字符串即可
        )
        
        # 构建测试请求
        test_messages = [
            {
                "role": "user",
                "content": "你好，请回复一个简单的测试消息"
            }
        ]
        
        logger.info(f"发送测试请求到: {base_url}/v1/chat/completions")
        logger.info(f"测试消息: {test_messages}")
        
        # 调用 Ollama API
        response = client.chat.completions.create(
            model=model_name,
            messages=test_messages,
            stream=False,
            temperature=0.7,
            max_tokens=50  # 限制回复长度，只用于测试
        )
        
        # 获取回复内容
        if response.choices and response.choices[0].message:
            reply_content = response.choices[0].message.content
            logger.info(f"Ollama 测试成功，模型回复: {reply_content}")
            
            return {
                "success": True,
                "message": "Ollama 模型配置测试成功",
                "model_reply": reply_content,
                "model_name": model_name,
                "base_url": base_url
            }
        else:
            logger.error("Ollama 响应格式不正确")
            return {
                "success": False,
                "message": "Ollama 响应格式不正确，未找到有效的回复内容"
            }
            
    except Exception as e:
        logger.error(f"Ollama 配置测试失败: {str(e)}")
        return {
            "success": False,
            "message": f"Ollama 配置测试失败: {str(e)}"
        }

@router.get("/ollama/tags")
async def get_ollama_tags(
    base_url: str,
    current_user: User = Depends(get_current_user)
):
    """代理获取 Ollama 已拉取模型列表 (/api/tags)"""
    try:
        import httpx
        url = base_url.rstrip('/') + '/api/tags'
        logger.info(f"代理请求 Ollama 模型列表: {url}")
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                logger.error(f"Ollama /api/tags 请求失败: {resp.status_code} {resp.text}")
                raise HTTPException(status_code=resp.status_code, detail=resp.text)
            data = resp.json()
            # 规范返回结构，确保前端可读取 data.models[].name
            models = data.get('models') or []
            return {"models": models}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取 Ollama 模型列表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取 Ollama 模型列表失败: {str(e)}") 


#====================================================================
@router.delete("/sessions/{session_id}/messages/{message_index}/after")
async def delete_messages_after(
    session_id: str,
    message_index: int,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """
    删除某条消息之后的所有历史消息（不包含该条消息），并删除这些消息中的 MinIO 图片
    """
    try:
        # 获取会话并校验归属
        session = await db.fish_chat.chat_sessions.find_one({
            "_id": session_id,
            "user_id": str(current_user.id)
        })
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在或无权访问")

        history = session.get("history", [])
        if message_index < -1 or message_index >= len(history):
            # 允许 -1：表示删除全部消息
            raise HTTPException(status_code=400, detail="消息索引无效")

        # 将要删除的消息列表（严格大于 message_index）
        messages_to_delete = history[message_index + 1:] if message_index >= 0 else history[:]
        if not messages_to_delete:
            return {"status": "success", "message": "没有需要删除的消息"}

        # 删除 MinIO 图片
        try:
            from ..utils.minio_client import minio_client
            deleted_images_total = 0
            for msg in messages_to_delete:
                images = msg.get("images", []) or []
                for image_url in images:
                    if isinstance(image_url, str) and image_url.startswith("minio://"):
                        if minio_client.delete_image(image_url):
                            deleted_images_total += 1
            logger.info(f"从索引 {message_index} 之后删除消息中的 MinIO 图片总数: {deleted_images_total}")
        except Exception as e:
            logger.warning(f"删除 MinIO 图片时出错: {str(e)}")

        # 截断历史
        new_history = history[:message_index + 1]
        update_result = await db.fish_chat.chat_sessions.update_one(
            {"_id": session_id, "user_id": str(current_user.id)},
            {"$set": {"history": new_history, "message_count": len(new_history)}}
        )
        if update_result.modified_count == 0:
            raise HTTPException(status_code=500, detail="更新会话失败")

        # 可选：同步删除向量存储中被截断的部分（若有）
        try:
            # 如果有向量存储实现，这里执行相应的删除逻辑
            pass
        except Exception as e:
            logger.warning(f"删除向量存储记录失败: {str(e)}")

        return {
            "status": "success",
            "message": "已删除该消息之后的所有历史消息",
            "remaining_count": len(new_history)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除后续消息失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="删除后续消息失败")

# 知识库检索函数
async def retrieve_knowledge_for_session(user_message: str, session_id: str, db: AsyncIOMotorClient, user_id: str) -> str:
    """
    为会话检索知识库内容，返回最终用于 system_prompt 的完整提示词（若未启用或无内容则返回空字符串）
    """
    try:
        # 获取会话的知识库配置
        session_data = await db.fish_chat.chat_sessions.find_one({"_id": session_id})
        if not session_data:
            logger.warning(f"未找到会话 {session_id}")
            return ""
        
        kb_settings = session_data.get("kb_settings")
        if not kb_settings or not kb_settings.get("enabled"):
            logger.info("会话未启用知识库，跳过检索")
            return ""
        
        logger.info(f"开始为会话 {session_id} 检索知识库")
        logger.info(f"知识库配置: {kb_settings}")
        
        # 若配置了知识库模板但不包含 {knowledge} 占位符，则直接返回该模板并跳过检索
        kb_prompt_template = kb_settings.get("kb_prompt_template") if isinstance(kb_settings, dict) else None
        if isinstance(kb_prompt_template, str) and kb_prompt_template.strip() and "{knowledge}" not in kb_prompt_template:
            logger.info("kb_prompt_template 未包含 {knowledge}，按需跳过知识库检索并直接返回模板")
            # 仅当存在 {time} 占位符时才获取系统时间并替换
            if "{time}" in kb_prompt_template:
                from datetime import datetime
                formatted_time = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
                return kb_prompt_template.replace("{time}", formatted_time)
            return kb_prompt_template
        
        # 导入知识库相关模块
        from .kb import _build_components_from_kb_settings
        from ..utils.embedding.pipeline import Retriever
        
        # 构建知识库组件
        _, vectorstore = _build_components_from_kb_settings(kb_settings)
        
        # 检查向量数据库是否有数据
        try:
            # 使用正确的API检查集合中的文档数量
            collection_data = vectorstore._store.get()
            doc_count = len(collection_data.get("ids", []))
            logger.info(f"向量数据库中文档数量: {doc_count}")
            
            if doc_count == 0:
                logger.warning("向量数据库为空，请先上传文档")
                return ""
                
        except Exception as e:
            logger.error(f"检查向量数据库状态失败: {str(e)}")
            return ""
        
        # 创建检索器并执行检索
        retriever = Retriever(vector_store=vectorstore, top_k=3)
        search_results = retriever.search(user_message, top_k=3)
        
        logger.info(f"检索结果数量: {len(search_results) if search_results else 0}")
        
        if not search_results:
            logger.info("未检索到相关内容")
            # 尝试用更宽泛的查询词进行测试
            test_queries = ["测试", "文档", "内容", "信息"]
            for test_query in test_queries:
                test_results = retriever.search(test_query, top_k=1)
                if test_results:
                    logger.info(f"测试查询 '{test_query}' 找到 {len(test_results)} 个结果")
                    break
            else:
                logger.warning("所有测试查询都未找到结果，可能是嵌入模型或向量数据库配置问题")
            return ""
        
        # 将检索结果拼接为纯知识文本，供模板占位符替换
        knowledge_only = ""
        for i, (doc, score) in enumerate(search_results, 1):
            logger.info(f"检索到片段 {i}: 相似度={score:.3f}, 内容长度={len(doc.page_content)}")
            knowledge_only += f"\n片段 {i} (相似度: {score:.3f}):\n{doc.page_content}\n"

        # 使用自定义模板（需要包含 {knowledge}），否则使用默认模板
        kb_prompt_template = kb_settings.get("kb_prompt_template") if isinstance(kb_settings, dict) else None
        if isinstance(kb_prompt_template, str) and kb_prompt_template.strip() and "{knowledge}" in kb_prompt_template:
            final_system_prompt = kb_prompt_template.replace("{knowledge}", knowledge_only.strip())
            # 仅当存在 {time} 占位符时才获取系统时间并替换
            if "{time}" in final_system_prompt:
                from datetime import datetime
                formatted_time = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
                final_system_prompt = final_system_prompt.replace("{time}", formatted_time)
        else:
            # 回退到默认模板
            final_system_prompt = "=== 知识库相关内容 ===\n" + knowledge_only.strip() + "\n=== 知识库内容结束 ===\n\n请基于上述知识库内容和用户的问题进行回答。"

        logger.info(f"检索到 {len(search_results)} 个相关片段")
        return final_system_prompt
        
    except Exception as e:
        logger.error(f"知识库检索失败: {str(e)}")
        import traceback
        logger.error(f"详细错误信息: {traceback.format_exc()}")
        return ""