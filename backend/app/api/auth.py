from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import OAuth2PasswordRequestForm
from datetime import timedelta
from ..models.user import UserCreate, UserResponse, User
from ..database import users_collection
from ..utils.auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user
)
from ..config import settings
from pymongo.errors import DuplicateKeyError
import logging
import re

# 配置日志
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register", response_model=UserResponse)
async def register(user: UserCreate):
    """用户注册"""
    try:
        # 创建用户文档
        hashed_password = get_password_hash(user.password)
        logger.debug(f"Hashed password for user {user.account}: {hashed_password}")
        
        user_doc = {
            "account": user.account,
            "email": user.email,
            "hashed_password": hashed_password
        }
        
        # 保存到数据库
        await users_collection.insert_one(user_doc)
        logger.debug(f"User {user.account} registered successfully")
        
        # 返回用户信息（不包含密码）
        return {"account": user.account, "email": user.email}
        
    except DuplicateKeyError as e:
        if "account" in str(e):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Account already exists"
            )
        elif "email" in str(e):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already exists"
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration failed due to duplicate information"
        )
    except Exception as e:
        logger.error(f"Registration error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration failed"
        )

@router.post("/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """用户登录 - 支持邮箱或账号登录"""
    logger.debug(f"Login attempt for identifier: {form_data.username}")
    
    # 判断是邮箱还是账号
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    is_email = re.match(email_pattern, form_data.username)
    
    # 根据类型查找用户
    if is_email:
        logger.debug(f"Attempting email login for: {form_data.username}")
        user = await users_collection.find_one({"email": form_data.username})
        if not user:
            logger.debug(f"Email {form_data.username} not found")
    else:
        logger.debug(f"Attempting account login for: {form_data.username}")
        user = await users_collection.find_one({"account": form_data.username})
        if not user:
            logger.debug(f"Account {form_data.username} not found")
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号/邮箱或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    logger.debug(f"Found user: {user['account']} (email: {user['email']})")
    logger.debug(f"Stored hash: {user['hashed_password']}")
    
    # 验证密码
    if not verify_password(form_data.password, user["hashed_password"]):
        logger.debug(f"Password verification failed for {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号/邮箱或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    logger.debug(f"Password verified for user: {user['account']}")
    
    # 创建访问令牌
    access_token = create_access_token(
        data={"sub": user["account"]},
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes)
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": UserResponse(account=user["account"], email=user["email"])
    }

@router.get("/me", response_model=UserResponse)
async def read_users_me(current_user: User = Depends(get_current_user)):
    """获取当前用户信息"""
    # 将 User 转换为 UserResponse
    return UserResponse(
        id=current_user.id,
        account=current_user.account,
        email=current_user.email or ""
    ) 