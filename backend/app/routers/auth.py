import uuid
import base64
from datetime import timedelta, datetime
from typing import Optional, Any
from fastapi import APIRouter, Depends, HTTPException, status, Body
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient

from ..models.user import (
    User,
    UserCreate,
    authenticate_user,
    authenticate_user_by_identifier,  # 添加这个导入
    create_access_token,
    get_password_hash,
    get_current_active_user,
    users_collection,
    get_current_user,
    get_user_by_email
)
from ..models.verification import verify_code
from ..config import Settings
from pydantic import BaseModel
from typing import Dict, Optional
from fastapi import HTTPException
from fastapi.responses import Response
from ..utils.minio_client import minio_client
from ..database import get_database
import logging

logger = logging.getLogger(__name__)

class AvatarUploadRequest(BaseModel):
    avatar: str  # base64编码的图片数据

class RoleAvatarUploadRequest(BaseModel):
    avatar: str  # base64编码的图片数据
    session_id: str  # 会话ID

# 为助手头像上传新增请求模型
class AssistantAvatarUploadRequest(BaseModel):
    avatar: str  # base64编码的图片数据
    assistant_id: str  # 助手ID

# 配置
settings = Settings()

# 创建路由
router = APIRouter(
    prefix="/auth",
    tags=["auth"]
)

class Token(BaseModel):
    access_token: str
    token_type: str

class UserCreate(BaseModel):
    account: str
    email: Optional[str] = None
    password: str
    full_name: Optional[str] = None

class UserCreateWithVerification(BaseModel):
    """带邮箱验证的用户注册请求"""
    account: str
    email: str
    password: str
    verification_code: str
    full_name: Optional[str] = None

class ModelConfig(BaseModel):
    base_url: str
    api_key: str

class AppSettingsResponse(BaseModel):
    email_verification: bool

@router.post("/register", response_model=User)
async def register(user_data: UserCreate):
    """用户注册（不需要邮箱验证）"""
    # 检查账号是否已存在
    if await users_collection.find_one({"account": user_data.account}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="账号已存在"
        )

    # 如果提供了邮箱，检查邮箱是否已被使用
    if user_data.email:
        existing_email_user = await get_user_by_email(user_data.email)
        if existing_email_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="该邮箱已被注册"
            )

    # 创建新用户
    user_id = str(uuid.uuid4())
    user_dict = {
        "id": user_id,
        "account": user_data.account,
        "email": user_data.email,
        "full_name": user_data.full_name,
        "hashed_password": get_password_hash(user_data.password),
        "disabled": False
    }

    # 保存到数据库
    await users_collection.insert_one(user_dict)

    # 返回用户信息（不包含密码）
    return User(**user_dict)

@router.post("/register-with-email", response_model=User)
async def register_with_email_verification(user_data: UserCreateWithVerification):
    """用户注册（需要邮箱验证）"""
    import re
    from ..config import settings
    
    # 检查邮件验证是否启用
    if not settings.email_verification:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="邮箱验证服务未启用"
        )
    
    # 验证邮箱格式
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, user_data.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="邮箱格式不正确"
        )
    
    # 验证验证码
    is_valid_code = await verify_code(user_data.email.lower(), user_data.verification_code)
    if not is_valid_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码无效或已过期"
        )
    
    # 检查账号是否已存在
    if await users_collection.find_one({"account": user_data.account}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="账号已存在"
        )

    # 检查邮箱是否已被使用
    existing_email_user = await get_user_by_email(user_data.email)
    if existing_email_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮箱已被注册"
        )

    # 创建新用户
    user_id = str(uuid.uuid4())
    user_dict = {
        "id": user_id,
        "account": user_data.account,
        "email": user_data.email.lower(),
        "full_name": user_data.full_name,
        "hashed_password": get_password_hash(user_data.password),
        "disabled": False,
        "email_verified": True  # 标记邮箱已验证
    }

    # 保存到数据库
    await users_collection.insert_one(user_dict)

    # 返回用户信息（不包含密码）
    return User(**user_dict)

@router.post("/token", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """用户登录 - 支持邮箱或账号登录"""
    import re
    
    # 判断是邮箱还是账号
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    is_email = re.match(email_pattern, form_data.username)
    
    if is_email:
        # 邮箱登录
        user = await authenticate_user_by_identifier(form_data.username, form_data.password)
    else:
        # 账号登录
        user = await authenticate_user(form_data.username, form_data.password)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号/邮箱或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_access_token(
        data={"sub": user.account},
        expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_active_user)):
    """获取当前用户信息"""
    return current_user

@router.put("/me", response_model=User)
async def update_user_me(
    user_data: UserCreate,
    current_user: User = Depends(get_current_active_user)
):
    """更新当前用户信息"""
    # 检查新账号是否与其他用户冲突
    if user_data.account != current_user.account:
        if await users_collection.find_one({"account": user_data.account}):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="账号已存在"
            )

    # 更新用户信息
    update_data = {
        "account": user_data.account,
        "email": user_data.email,
        "full_name": user_data.full_name
    }

    # 如果提供了新密码，更新密码
    if user_data.password:
        update_data["hashed_password"] = get_password_hash(user_data.password)

    # 更新数据库
    await users_collection.update_one(
        {"id": current_user.id},
        {"$set": update_data}
    )

    # 获取更新后的用户信息
    updated_user = await users_collection.find_one({"id": current_user.id})
    return User(**updated_user)

@router.get("/model-config/{model_service}", response_model=ModelConfig)
async def get_model_config(
    model_service: str,
    current_user: User = Depends(get_current_active_user)
):
    """获取指定模型服务的配置"""
    print(f"[DEBUG] 请求获取 {model_service} 的配置")
    print(f"[DEBUG] 当前环境变量:")
    print(f"[DEBUG] DOUBAO_BASE_URL: {settings.doubao_base_url}")
    print(f"[DEBUG] DOUBAO_API_KEY: {'已设置' if settings.doubao_api_key else '未设置'}")
    print(f"[DEBUG] DEEPSEEK_BASE_URL: {settings.deepseek_base_url}")
    print(f"[DEBUG] DEEPSEEK_API_KEY: {'已设置' if settings.deepseek_api_key else '未设置'}")
    
    config_map = {
        "doubao": {
            "base_url": settings.doubao_base_url,
            "api_key": settings.doubao_api_key
        },
        "deepseek": {
            "base_url": settings.deepseek_base_url,
            "api_key": settings.deepseek_api_key
        },
        "ollama": {
            "base_url": "http://localhost:11434",
            "api_key": ""
        },
        "local": {
            "base_url": "http://localhost:8000",
            "api_key": ""
        }
    }
    
    if model_service not in config_map:
        print(f"[DEBUG] 不支持的模型服务: {model_service}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不支持的模型服务"
        )
    
    config = config_map[model_service]
    print(f"[DEBUG] 返回配置: {config}")
    return ModelConfig(**config)

@router.post("/upload-avatar")
async def upload_avatar(
    avatar_data: AvatarUploadRequest,
    current_user: User = Depends(get_current_active_user)
):
    """上传用户头像"""
    try:
        # 生成唯一的文件名
        file_id = str(uuid.uuid4())
        object_name = f"avatars/{current_user.id}/{file_id}.jpg"
        
        # 上传到MinIO
        minio_url = minio_client.upload_image(
            avatar_data.avatar,
            f"users/{current_user.id}",
            "avatar"
        )
        
        if not minio_url:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="头像上传失败"
            )
        
        # 更新用户信息中的头像URL
        await users_collection.update_one(
            {"id": current_user.id},
            {"$set": {"avatar_url": minio_url}}
        )
        
        return {"avatar_url": minio_url}
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"头像上传失败: {str(e)}"
        )

@router.post("/upload-role-avatar")
async def upload_role_avatar(
    avatar_data: RoleAvatarUploadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """上传角色头像"""
    try:
        file_id = str(uuid.uuid4())
        object_name = f"roles/{avatar_data.session_id}/{file_id}.jpg"

        logger.info(
            f"🖼️ 准备上传角色头像 session_id={avatar_data.session_id} user_id={current_user.id} object_name={object_name}"
        )
        
        minio_url = minio_client.upload_image(
            avatar_data.avatar,
            f"users/{current_user.id}/sessions/{avatar_data.session_id}",
            "role_avatar"
        )

        logger.info(f"🖼️ 角色头像已上传到MinIO url={minio_url}")
        
        if not minio_url:
            logger.error("❌ 角色头像上传失败，minio_url 为空")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="角色头像上传失败"
            )
        
        # 首次尝试：按 _id + user_id 进行精准匹配更新
        filter_precise = {"_id": avatar_data.session_id, "user_id": str(current_user.id)}
        update_doc = {"$set": {"role_avatar_url": minio_url, "updated_at": datetime.now().isoformat()}}
        result = await db.fish_chat.ragflow_sessions.update_one(filter_precise, update_doc, upsert=False)
        logger.info(
            f"🗄️ 精准更新会话头像 matched={result.matched_count} modified={result.modified_count} filter={filter_precise}"
        )

        # 如果精准匹配没有命中，退化为仅按 _id 更新（避免因user_id不一致导致失败）
        if result.matched_count == 0:
            filter_relaxed = {"_id": avatar_data.session_id}
            result_relaxed = await db.fish_chat.ragflow_sessions.update_one(filter_relaxed, update_doc, upsert=False)
            logger.warning(
                f"⚠️ 精准匹配未命中，已使用简化条件更新 matched={result_relaxed.matched_count} modified={result_relaxed.modified_count} filter={filter_relaxed}"
            )
        
        # 读取并打印当前会话的role_avatar_url以确认
        session_after = await db.fish_chat.ragflow_sessions.find_one({"_id": avatar_data.session_id})
        current_url = (session_after or {}).get("role_avatar_url")
        logger.info(
            f"🔎 更新后会话检查 _id={avatar_data.session_id} role_avatar_url={current_url}"
        )
        
        return {"avatar_url": minio_url}
        
    except Exception as e:
        logger.error(f"❌ 角色头像上传/写库失败: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"角色头像上传失败: {str(e)}"
        )

# 新增：上传助手头像
@router.post("/upload-assistant-avatar")
async def upload_assistant_avatar(
    avatar_data: AssistantAvatarUploadRequest,
    current_user: User = Depends(get_current_active_user)
):
    """上传助手头像，返回MinIO地址，由前端再调用RAGFlow接口更新助手资料。"""
    try:
        file_id = str(uuid.uuid4())
        object_name = f"assistants/{avatar_data.assistant_id}/{file_id}.jpg"
        
        logger.info(f"🖼️ 开始上传助手头像 assistant_id={avatar_data.assistant_id} object_name={object_name} user_id={current_user.id}")

        minio_url = minio_client.upload_image(
            avatar_data.avatar,
            f"users/{current_user.id}/assistants/{avatar_data.assistant_id}",
            "avatar"
        )

        logger.info(f"🖼️ 助手头像上传完成 assistant_id={avatar_data.assistant_id} minio_url={minio_url}")

        if not minio_url:
            logger.error("❌ 助手头像上传失败，minio_url 为空")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="助手头像上传失败"
            )

        return {"avatar_url": minio_url}

    except Exception as e:
        logger.error(f"❌ 助手头像上传异常: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"助手头像上传失败: {str(e)}"
        )

# 新增：上传助手会话头像（助手会话的角色头像）
@router.post("/upload-assistant-role-avatar")
async def upload_assistant_role_avatar(
    avatar: str = Body(..., embed=True, description="Base64头像数据，不含data:image前缀"),
    assistant_id: str = Body(..., embed=True, description="助手ID"),
    session_id: str = Body(..., embed=True, description="助手会话ID"),
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """上传助手会话头像，存储在 users/{userId}/assistants/{assistantId}/sessions/{sessionId}/role_avatar 下"""
    try:
        logger.info(
            f"🖼️ 准备上传助手会话头像 user_id={current_user.id} assistant_id={assistant_id} session_id={session_id}"
        )
        minio_url = minio_client.upload_image(
            avatar,
            f"users/{current_user.id}/assistants/{assistant_id}/sessions/{session_id}",
            "role_avatar"
        )
        if not minio_url:
            raise HTTPException(status_code=500, detail="助手会话头像上传失败")

        # 更新 RAGFlow 会话记录（与传统会话相同字段）
        update_doc = {"$set": {"role_avatar_url": minio_url, "updated_at": datetime.now().isoformat()}}
        result = await db.fish_chat.ragflow_sessions.update_one({"_id": session_id}, update_doc, upsert=False)
        logger.info(
            f"🗄️ 更新助手会话头像 matched={result.matched_count} modified={result.modified_count} session_id={session_id}"
        )
        return {"avatar_url": minio_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 助手会话头像上传失败: {e}")
        raise HTTPException(status_code=500, detail=f"助手会话头像上传失败: {str(e)}")

@router.post("/upload-role-background")
async def upload_role_background(
    avatar_data: RoleAvatarUploadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """上传会话背景图（传统会话、RAGFlow会话均尝试更新）"""
    try:
        logger.info(
            f"🖼️ 准备上传会话背景 session_id={avatar_data.session_id} user_id={current_user.id}"
        )
        minio_url = minio_client.upload_image(
            avatar_data.avatar,
            f"users/{current_user.id}/sessions/{avatar_data.session_id}",
            "role_background"
        )
        logger.info(f"🖼️ 会话背景已上传到MinIO url={minio_url}")

        if not minio_url:
            logger.error("❌ 会话背景上传失败，minio_url 为空")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="会话背景上传失败"
            )

        update_doc = {"$set": {"role_background_url": minio_url, "updated_at": datetime.now().isoformat()}}

        # 先更新 ragflow_sessions
        result_rag = await db.fish_chat.ragflow_sessions.update_one({"_id": avatar_data.session_id, "user_id": str(current_user.id)}, update_doc, upsert=False)
        logger.info(f"🗄️ 更新RAGFlow会话背景 matched={result_rag.matched_count} modified={result_rag.modified_count}")

        # 再更新 chat_sessions（传统会话）
        result_traditional = await db.fish_chat.chat_sessions.update_one({"_id": avatar_data.session_id, "user_id": str(current_user.id)}, update_doc, upsert=False)
        logger.info(f"🗄️ 更新传统会话背景 matched={result_traditional.matched_count} modified={result_traditional.modified_count}")

        return {"background_url": minio_url}

    except Exception as e:
        logger.error(f"❌ 会话背景上传/写库失败: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"会话背景上传失败: {str(e)}"
        )

# 新增：上传助手会话背景
@router.post("/upload-assistant-role-background")
async def upload_assistant_role_background(
    avatar: str = Body(..., embed=True, description="Base64背景图，不含data:image前缀亦可"),
    assistant_id: str = Body(..., embed=True, description="助手ID"),
    session_id: str = Body(..., embed=True, description="助手会话ID"),
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """上传助手会话背景，存储在 users/{userId}/assistants/{assistantId}/sessions/{sessionId}/role_background 下，并写库 role_background_url"""
    try:
        logger.info(
            f"🖼️ 准备上传助手会话背景 user_id={current_user.id} assistant_id={assistant_id} session_id={session_id}"
        )
        minio_url = minio_client.upload_image(
            avatar,
            f"users/{current_user.id}/assistants/{assistant_id}/sessions/{session_id}",
            "role_background"
        )
        if not minio_url:
            raise HTTPException(status_code=500, detail="助手会话背景上传失败")

        update_doc = {"$set": {"role_background_url": minio_url, "updated_at": datetime.now().isoformat()}}
        result = await db.fish_chat.ragflow_sessions.update_one({"_id": session_id, "user_id": str(current_user.id)}, update_doc, upsert=False)
        logger.info(
            f"🗄️ 更新助手会话背景 matched={result.matched_count} modified={result.modified_count} session_id={session_id}"
        )
        return {"background_url": minio_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 助手会话背景上传失败: {e}")
        raise HTTPException(status_code=500, detail=f"助手会话背景上传失败: {str(e)}")

@router.get("/avatar/{user_id}/{filename}")
async def get_avatar(user_id: str, filename: str):
    """获取用户头像"""
    try:
        # 构建MinIO对象路径
        object_name = f"users/{user_id}/avatar/{filename}"
        minio_url = f"minio://{settings.minio_bucket_name}/{object_name}"
        
        # 从MinIO获取图片
        image_base64 = minio_client.get_image_base64(minio_url)
        if not image_base64:
            raise HTTPException(status_code=404, detail="头像不存在")
        
        # 转换为二进制数据
        if image_base64.startswith("data:image"):
            image_data = base64.b64decode(image_base64.split(',')[1])
        else:
            image_data = base64.b64decode(image_base64)
        
        return Response(content=image_data, media_type="image/png")
        
    except Exception as e:
        print(f"❌ 获取头像失败: {e}")
        raise HTTPException(status_code=500, detail="获取头像失败")

@router.get("/role-avatar/{user_id}/{session_id}/{filename}")
async def get_role_avatar(user_id: str, session_id: str, filename: str):
    """获取角色头像"""
    try:
        # 构建MinIO对象路径
        object_name = f"users/{user_id}/sessions/{session_id}/role_avatar/{filename}"
        minio_url = f"minio://{settings.minio_bucket_name}/{object_name}"
        
        # 从MinIO获取图片
        image_base64 = minio_client.get_image_base64(minio_url)
        if not image_base64:
            raise HTTPException(status_code=404, detail="角色头像不存在")
        
        # 转换为二进制数据
        if image_base64.startswith("data:image"):
            image_data = base64.b64decode(image_base64.split(',')[1])
        else:
            image_data = base64.b64decode(image_base64)
        
        return Response(content=image_data, media_type="image/png")
        
    except Exception as e:
        print(f"❌ 获取角色头像失败: {e}")
        raise HTTPException(status_code=500, detail="获取角色头像失败")

# 新增：获取助手头像
@router.get("/assistant-avatar/{user_id}/{assistant_id}/{filename}")
async def get_assistant_avatar(user_id: str, assistant_id: str, filename: str):
    """获取助手头像"""
    try:
        object_name = f"users/{user_id}/assistants/{assistant_id}/avatar/{filename}"
        minio_url = f"minio://{settings.minio_bucket_name}/{object_name}"
        logger.info(f"🖼️ 读取助手头像 assistant_id={assistant_id} object_name={object_name} url={minio_url}")

        image_base64 = minio_client.get_image_base64(minio_url)
        if not image_base64:
            logger.warning(f"⚠️ 助手头像不存在 assistant_id={assistant_id} object_name={object_name}")
            raise HTTPException(status_code=404, detail="助手头像不存在")

        if image_base64.startswith("data:image"):
            image_data = base64.b64decode(image_base64.split(',')[1])
        else:
            image_data = base64.b64decode(image_base64)

        logger.info(f"✅ 返回助手头像 assistant_id={assistant_id} size={len(image_data)} bytes")
        return Response(content=image_data, media_type="image/png")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 获取助手头像失败: {e}")
        raise HTTPException(status_code=500, detail="获取助手头像失败")

# 新增：获取助手会话头像
@router.get("/assistant-role-avatar/{user_id}/{assistant_id}/{session_id}/{filename}")
async def get_assistant_role_avatar(user_id: str, assistant_id: str, session_id: str, filename: str):
    """获取助手会话头像（助手会话的角色头像）"""
    try:
        object_name = f"users/{user_id}/assistants/{assistant_id}/sessions/{session_id}/role_avatar/{filename}"
        minio_url = f"minio://{settings.minio_bucket_name}/{object_name}"
        logger.info(
            f"🖼️ 读取助手会话头像 user_id={user_id} assistant_id={assistant_id} session_id={session_id} url={minio_url}"
        )
        image_base64 = minio_client.get_image_base64(minio_url)
        if not image_base64:
            raise HTTPException(status_code=404, detail="助手会话头像不存在")
        if image_base64.startswith("data:image"):
            image_data = base64.b64decode(image_base64.split(',')[1])
        else:
            image_data = base64.b64decode(image_base64)
        return Response(content=image_data, media_type="image/png")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 获取助手会话头像失败: {e}")
        raise HTTPException(status_code=500, detail="获取助手会话头像失败")

@router.get("/image/{session_id}/{message_id}/{filename}")
async def get_image(session_id: str, message_id: str, filename: str):
    """获取图片（旧路径结构，向后兼容）"""
    try:
        # 构建MinIO对象路径
        object_name = f"{session_id}/{message_id}/{filename}"
        minio_url = f"minio://{settings.minio_bucket_name}/{object_name}"
        
        logger.info(f"📸 获取图片（旧路径）: {object_name}")
        
        # 从MinIO获取图片
        image_base64 = minio_client.get_image_base64(minio_url)
        if not image_base64:
            raise HTTPException(status_code=404, detail="图片不存在")
        
        # 转换为二进制数据
        if image_base64.startswith("data:image"):
            image_data = base64.b64decode(image_base64.split(',')[1])
        else:
            image_data = base64.b64decode(image_base64)
        
        return Response(content=image_data, media_type="image/png")
        
    except Exception as e:
        logger.error(f"❌ 获取图片失败（旧路径）: {e}")
        raise HTTPException(status_code=500, detail="获取图片失败")

@router.get("/message-image/{user_id}/{session_id}/{filename}")
async def get_message_image(user_id: str, session_id: str, filename: str):
    """获取传统会话消息图片（新路径结构，完全用户隔离）"""
    try:
        # 构建MinIO对象路径
        object_name = f"users/{user_id}/sessions/{session_id}/message_image/{filename}"
        minio_url = f"minio://{settings.minio_bucket_name}/{object_name}"
        
        logger.info(f"📸 获取传统会话消息图片: {object_name}")
        
        # 从MinIO获取图片
        image_base64 = minio_client.get_image_base64(minio_url)
        if not image_base64:
            raise HTTPException(status_code=404, detail="图片不存在")
        
        # 转换为二进制数据
        if image_base64.startswith("data:image"):
            image_data = base64.b64decode(image_base64.split(',')[1])
        else:
            image_data = base64.b64decode(image_base64)
        
        return Response(content=image_data, media_type="image/png")
        
    except Exception as e:
        logger.error(f"❌ 获取传统会话消息图片失败: {e}")
        raise HTTPException(status_code=500, detail="获取传统会话消息图片失败")

@router.get("/image/{user_id}/{session_id}/{message_id}/{filename}")
async def get_image_with_user_isolation(user_id: str, session_id: str, message_id: str, filename: str):
    """获取图片（旧路径结构，向后兼容）"""
    try:
        # 构建MinIO对象路径
        object_name = f"users/{user_id}/sessions/{session_id}/messages/{message_id}/{filename}"
        minio_url = f"minio://{settings.minio_bucket_name}/{object_name}"
        
        logger.info(f"📸 获取图片（用户隔离路径，向后兼容）: {object_name}")
        
        # 从MinIO获取图片
        image_base64 = minio_client.get_image_base64(minio_url)
        if not image_base64:
            raise HTTPException(status_code=404, detail="图片不存在")
        
        # 转换为二进制数据
        if image_base64.startswith("data:image"):
            image_data = base64.b64decode(image_base64.split(',')[1])
        else:
            image_data = base64.b64decode(image_base64)
        
        return Response(content=image_data, media_type="image/png")
        
    except Exception as e:
        logger.error(f"❌ 获取图片失败（用户隔离路径，向后兼容）: {e}")
        raise HTTPException(status_code=500, detail="获取图片失败") 

@router.get("/settings", response_model=AppSettingsResponse)
async def get_app_settings():
    """返回应用可供前端使用的配置开关"""
    return AppSettingsResponse(email_verification=settings.email_verification)

@router.delete("/account")
async def delete_account(
    current_user: User = Depends(get_current_active_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """注销当前账号：
    - 删除当前用户的传统会话
    - 删除当前用户的智能助手会话（仅会话，不删除助手本体），包含远程RAGFlow与本地记录
    - 删除当前用户在MinIO下的所有图片前缀（直接删除 users/{user_id}/ 根目录）
    - 删除用户账号本身
    """
    try:
        logger = logging.getLogger(__name__)
        user_id = str(current_user.id)
        logger.info(f"开始注销账号 user_id={user_id} account={current_user.account}")

        # 统一构造兼容的 user_id 过滤器（兼容历史字段名与类型）
        try:
            from bson import ObjectId

            # 读取数据库中的用户文档，拿到 Mongo `_id` 与历史 `id`
            user_doc = await db.fish_chat.users.find_one({"account": current_user.account})

            id_variants: list[Any] = []
            # 1) 当前凭据中的 id（可能是 UUID 字符串）
            id_variants.append(user_id)
            # 2) 用户文档中的 `_id`（ObjectId 与其字符串形式）
            if user_doc and user_doc.get("_id") is not None:
                mongo_oid = user_doc.get("_id")
                id_variants.append(mongo_oid)
                id_variants.append(str(mongo_oid))
                # 若字符串表现是合法 ObjectId，也加入解析后的对象（冗余但安全）
                if isinstance(mongo_oid, str) and ObjectId.is_valid(mongo_oid):
                    id_variants.append(ObjectId(mongo_oid))
            # 3) 用户文档中的 `id`（历史 UUID 字段）
            if user_doc and user_doc.get("id") is not None:
                legacy_id = user_doc.get("id")
                id_variants.append(legacy_id)
                id_variants.append(str(legacy_id))
                if isinstance(legacy_id, str) and ObjectId.is_valid(legacy_id):
                    id_variants.append(ObjectId(legacy_id))

            # 去重，保持原始类型
            def _uniq_keep_type(values: list[Any]) -> list[Any]:
                seen = set()
                result = []
                for v in values:
                    key = (type(v), str(v))
                    if key in seen:
                        continue
                    seen.add(key)
                    result.append(v)
                return result

            id_variants = _uniq_keep_type(id_variants)

            user_filter_or = []
            for field_name in ["user_id", "userId", "uid"]:
                for variant in id_variants:
                    user_filter_or.append({field_name: variant})

        except Exception as e_build:
            logger.warning(f"构造 user_id 兼容过滤器失败，将回退为字符串匹配: {e_build}")
            user_filter_or = [{"user_id": user_id}]

        # 1) 收集并批量删除远程RAGFlow会话（按助手分组）
        try:
            from ..services.ragflow_sdk import get_ragflow_sdk_service
            sdk_service = get_ragflow_sdk_service()
            rag = sdk_service._get_client()

            # 获取本地记录并按助手分组
            sessions_cursor = db.fish_chat.ragflow_sessions.find({
                "$or": user_filter_or
            })
            sessions = await sessions_cursor.to_list(length=None)
            logger.info(f"本地查询到待远程删除的RAGFlow会话数量: {len(sessions)}")

            assistant_to_session_ids: dict[str, list[str]] = {}
            for s in sessions:
                assistant_id = s.get("assistant_id")
                # 优先使用远程RAGFlow会话ID，其次兼容旧字段 session_id，最后兜底为字符串化的 _id
                session_id_for_remote = s.get("ragflow_session_id") or s.get("session_id") or (str(s.get("_id")) if s.get("_id") is not None else None)
                if assistant_id and session_id_for_remote:
                    assistant_to_session_ids.setdefault(assistant_id, []).append(str(session_id_for_remote))

            deleted_remote_groups = 0
            for assistant_id, session_ids in assistant_to_session_ids.items():
                try:
                    chats = rag.list_chats(id=assistant_id)
                    if not chats:
                        logger.warning(f"远程助手不存在，跳过: {assistant_id}")
                        continue
                    chat = chats[0]
                    # RAGFlow SDK 支持批量删除会话
                    chat.delete_sessions(ids=session_ids)
                    deleted_remote_groups += 1
                    logger.info(f"✅ 远程删除助手会话成功 assistant={assistant_id} count={len(session_ids)}")
                except Exception as e_assist:
                    logger.error(f"删除远程助手会话失败 assistant={assistant_id}: {e_assist}")
        except Exception as e_remote:
            # 远程删除失败不阻塞后续本地清理
            logging.getLogger(__name__).warning(f"远程RAGFlow批量删除阶段出现问题，继续本地清理: {e_remote}")

        # 2) 删除本地数据库中的RAGFlow会话记录（兼容多种 user_id 字段类型与历史字段名）
        deleted_rag_count = 0
        try:
            result_rag = await db.fish_chat.ragflow_sessions.delete_many({
                "$or": user_filter_or
            })
            deleted_rag_count = result_rag.deleted_count
            logger.info(f"本地RAGFlow会话删除: {deleted_rag_count}")
        except Exception as e_db_rag:
            logger.error(f"删除本地RAGFlow会话失败: {e_db_rag}")

        # 3) 删除本地数据库中的传统会话（兼容多种 user_id 字段类型与历史字段名）
        deleted_chat_count = 0
        try:
            result_chat = await db.fish_chat.chat_sessions.delete_many({
                "$or": user_filter_or
            })
            deleted_chat_count = result_chat.deleted_count
            logger.info(f"本地传统会话删除: {deleted_chat_count}")
        except Exception as e_db_chat:
            logger.error(f"删除本地传统会话失败: {e_db_chat}")

        # 若以上两类会话均删除为0，进行兜底遍历删除（严格匹配创建时标识，且兼容历史字段名）
        try:
            def _normalize(v: Any) -> str:
                return str(v).strip()

            # 使用同一套 id 变体字符串，便于与任意文档字段进行对比
            compare_variants: set[str] = set()
            for item in [user_id]:
                compare_variants.add(_normalize(item))
            try:
                if user_doc:
                    if user_doc.get("_id") is not None:
                        compare_variants.add(_normalize(user_doc.get("_id")))
                    if user_doc.get("id") is not None:
                        compare_variants.add(_normalize(user_doc.get("id")))
            except Exception:
                pass

            async def _bruteforce_purge(collection_name: str) -> int:
                col = db.fish_chat[collection_name]
                candidates = await col.find({}, {"_id": 1, "user_id": 1, "userId": 1, "uid": 1}).to_list(length=None)
                to_delete_ids = []
                for doc in candidates:
                    for key in ("user_id", "userId", "uid"):
                        if key in doc and _normalize(doc[key]) in compare_variants:
                            to_delete_ids.append(doc["_id"]) 
                            break
                if not to_delete_ids:
                    return 0
                res = await col.delete_many({"_id": {"$in": to_delete_ids}})
                return res.deleted_count

            if deleted_rag_count == 0:
                bf_rag = await _bruteforce_purge("ragflow_sessions")
                if bf_rag > 0:
                    logger.info(f"兜底遍历删除 RAGFlow 会话: {bf_rag}")
            if deleted_chat_count == 0:
                bf_chat = await _bruteforce_purge("chat_sessions")
                if bf_chat > 0:
                    logger.info(f"兜底遍历删除 传统 会话: {bf_chat}")
        except Exception as e_bf:
            logger.error(f"兜底遍历删除会话失败: {e_bf}")

        # 4) 删除 MinIO 中该用户根目录
        try:
            from ..utils.minio_client import minio_client
            user_root_prefix = f"users/{user_id}/"
            logger.info(f"开始删除用户MinIO根前缀: {user_root_prefix}")
            minio_client.delete_prefix(user_root_prefix)
            logger.info(f"✅ 用户MinIO根前缀删除完成: {user_root_prefix}")
        except Exception as e_minio:
            logger.error(f"删除MinIO用户根前缀失败: {e_minio}")

        # 5) 删除用户账号记录
        try:
            users_collection = db.fish_chat.users
            # 优先使用 Mongo `_id` 删除
            if user_doc and user_doc.get("_id") is not None:
                primary_res = await users_collection.delete_one({"_id": user_doc.get("_id")})
                if primary_res.deleted_count == 0:
                    await users_collection.delete_one({"id": user_id})
            else:
                # 回退：按历史 `id` 删除
                await users_collection.delete_one({"id": user_id})
        except Exception as e_user:
            logger.error(f"删除用户账号失败: {e_user}")

        return {"message": "账号已注销"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"注销账号失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"注销失败: {str(e)}") 

@router.get("/role-background/{session_id}")
async def get_role_background(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """获取会话背景（base64），优先在ragflow_sessions查找，其次chat_sessions"""
    try:
        # 查询两个集合
        doc = await db.fish_chat.ragflow_sessions.find_one({"_id": session_id, "user_id": str(current_user.id)})
        if not doc:
            doc = await db.fish_chat.chat_sessions.find_one({"_id": session_id, "user_id": str(current_user.id)})
        if not doc:
            raise HTTPException(status_code=404, detail="未找到会话")
        url = doc.get("role_background_url")
        if not url:
            raise HTTPException(status_code=404, detail="该会话未设置背景")
        data_url = minio_client.get_image_base64(url)
        if not data_url:
            raise HTTPException(status_code=500, detail="从存储获取背景失败")
        return {"data_url": data_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取会话背景失败: {e}")
        raise HTTPException(status_code=500, detail="获取会话背景失败")

@router.get("/assistant-role-background/{session_id}")
async def get_assistant_role_background(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """获取助手会话背景（base64），从 ragflow_sessions 查找"""
    try:
        doc = await db.fish_chat.ragflow_sessions.find_one({"_id": session_id, "user_id": str(current_user.id)})
        if not doc:
            raise HTTPException(status_code=404, detail="未找到助手会话")
        url = doc.get("role_background_url")
        if not url:
            raise HTTPException(status_code=404, detail="该会话未设置背景")
        data_url = minio_client.get_image_base64(url)
        if not data_url:
            raise HTTPException(status_code=500, detail="从存储获取背景失败")
        return {"data_url": data_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取助手会话背景失败: {e}")
        raise HTTPException(status_code=500, detail="获取助手会话背景失败") 