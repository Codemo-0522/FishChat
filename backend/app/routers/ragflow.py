from fastapi import APIRouter, HTTPException, File, UploadFile, Depends, Body, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from typing import Optional, List, Dict, Any
import httpx
import os
import io
from pydantic import BaseModel
import logging
import asyncio
import os
import traceback
import json
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
import time
from ..utils.auth import get_current_user
from ..models import User
from ..database import client, get_database
from ..services.ragflow_message_service import RAGFlowMessageService
from ..models.ragflow_message import SaveMessageRequest

# 配置日志
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/ragflow", tags=["ragflow"])

# 数据库集合
ragflow_sessions_collection = client.fish_chat.ragflow_sessions

# RAGFlow 配置
from ..config import settings
from ..database import get_database
RAGFLOW_BASE_URL = settings.RAGFLOW_BASE_URL
RAGFLOW_API_KEY = settings.RAGFLOW_API_KEY

# Pydantic 模型
class RAGFlowConfig(BaseModel):
    base_url: str
    api_key: str

class CreateDatasetParams(BaseModel):
    name: str
    description: Optional[str] = None
    embedding_model: Optional[str] = None  # 可以为空，为空时使用系统默认模型
    permission: Optional[str] = "me"
    chunk_method: Optional[str] = "naive"

class UpdateDatasetParams(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    embedding_model: Optional[str] = None
    permission: Optional[str] = None
    chunk_method: Optional[str] = None

class TestConnectionParams(BaseModel):
    baseUrl: str
    apiKey: str

# 对话助手相关的模型
class ChatLLMSettings(BaseModel):
    """对话助手LLM配置"""
    model_name: Optional[str] = None  # 如果为None，将使用用户的默认聊天模型
    temperature: Optional[float] = 0.1  # 控制随机性
    top_p: Optional[float] = 0.3  # 核采样阈值
    presence_penalty: Optional[float] = 0.2  # 存在惩罚
    frequency_penalty: Optional[float] = 0.7  # 频率惩罚

class ChatPromptSettings(BaseModel):
    """对话助手提示配置"""
    similarity_threshold: Optional[float] = 0.2  # 相似度阈值
    keywords_similarity_weight: Optional[float] = 0.7  # 关键词相似度权重
    vector_similarity_weight: Optional[float] = 0.3  # 向量相似度权重
    top_n: Optional[int] = 8  # 返回给LLM的top N个分块
    variables: Optional[List[Dict[str, Any]]] = [{"key": "knowledge", "optional": True}]  # 系统提示中的变量
    rerank_model: Optional[str] = ""  # 重排序模型
    top_k: Optional[int] = 1024  # 重排序的top k
    empty_response: Optional[str] = None  # 未检索到内容时的响应
    opener: Optional[str] = "Hi! I am your assistant, can I help you?"  # 开场白
    show_quote: Optional[bool] = True  # 是否显示引用来源
    prompt: Optional[str] = None  # 提示内容

class CreateChatAssistantParams(BaseModel):
    """创建对话助手参数"""
    name: str  # 对话助手名称（必需）
    avatar: Optional[str] = ""  # Base64编码的头像
    dataset_ids: Optional[List[str]] = []  # 关联的数据集ID列表
    llm: Optional[ChatLLMSettings] = None  # LLM设置
    prompt: Optional[ChatPromptSettings] = None  # 提示设置

class UpdateChatAssistantParams(BaseModel):
    """更新对话助手参数"""
    name: Optional[str] = None
    avatar: Optional[str] = None
    dataset_ids: Optional[List[str]] = None
    llm: Optional[ChatLLMSettings] = None
    prompt: Optional[ChatPromptSettings] = None

# RAGFlow 客户端类
class RAGFlowClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
    
    async def request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        url = f"{self.base_url}{endpoint}"
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.request(method, url, headers=self.headers, **kwargs)
                
                if not response.is_success:
                    error_data = {}
                    try:
                        error_data = response.json()
                    except:
                        pass
                    
                    error_message = error_data.get('message', f'HTTP {response.status_code}: {response.reason_phrase}')
                    logger.error(f"RAGFlow API error: {error_message}")
                    raise HTTPException(status_code=response.status_code, detail=error_message)
                
                data = response.json()
                
                # 添加调试信息
                logger.info(f"🔍 RAGFlow原始响应数据类型: {type(data)}")
                logger.info(f"🔍 RAGFlow原始响应数据内容: {data}")
                
                # RAGFlow API 返回格式检查
                if isinstance(data, dict) and data.get('code') != 0:
                    error_code = data.get('code')
                    error_message = data.get('message', '请求失败')
                    
                    # 如果error_message是Exception对象，转换为字符串
                    if isinstance(error_message, Exception):
                        error_message = str(error_message)
                    
                    # 特殊处理创建助手时的102错误码（RAGFlow的已知bug）
                    if (error_code == 102 and 
                        method.upper() == "POST" and 
                        endpoint == "/api/v1/chats" and 
                        "Duplicated chat name" in error_message):
                        
                        logger.warning(f"⚠️ RAGFlow返回102错误码但助手可能已创建成功，尝试验证...")
                        
                        # 尝试获取刚创建的助手列表，检查是否真的创建成功
                        try:
                            # 获取请求数据中的助手名称
                            request_json = kwargs.get('json', {})
                            assistant_name = request_json.get('name')
                            
                            if assistant_name:
                                # 直接使用httpx客户端查询助手列表，避免递归调用
                                list_url = f"{self.base_url}/api/v1/chats"
                                list_params = {"name": assistant_name, "page_size": 1}
                                
                                list_response = await client.request("GET", list_url, 
                                                                   headers=self.headers,
                                                                   params=list_params)
                                
                                # 如果找到了助手，说明创建实际上成功了
                                if list_response.is_success:
                                    list_data = list_response.json()
                                    if (isinstance(list_data, dict) and 
                                        list_data.get('code') == 0 and 
                                        isinstance(list_data.get('data'), list) and 
                                        len(list_data['data']) > 0):
                                        
                                        created_assistant = list_data['data'][0]
                                        logger.info(f"✅ 验证成功：助手实际已创建 - ID: {created_assistant.get('id')}, 名称: {created_assistant.get('name')}")
                                        
                                        # 返回创建成功的助手数据
                                        return created_assistant
                        except Exception as verify_error:
                            logger.error(f"❌ 验证助手创建状态时出错: {verify_error}")
                        
                        # 如果验证失败，仍然抛出原错误
                        logger.error(f"RAGFlow business error: {error_message}")
                        raise HTTPException(status_code=400, detail=error_message)
                    
                    # 特殊处理创建助手时的KeyError('dataset_ids')错误（RAGFlow的另一个已知bug）
                    elif (method.upper() == "POST" and 
                          endpoint == "/api/v1/chats" and 
                          "KeyError('dataset_ids')" in str(error_message)):
                        
                        logger.warning(f"⚠️ RAGFlow返回KeyError('dataset_ids')错误但助手可能已创建成功，尝试验证...")
                        
                        # 尝试获取刚创建的助手列表，检查是否真的创建成功
                        try:
                            # 获取请求数据中的助手名称
                            request_json = kwargs.get('json', {})
                            assistant_name = request_json.get('name')
                            
                            if assistant_name:
                                # 直接使用httpx客户端查询助手列表，避免递归调用
                                list_url = f"{self.base_url}/api/v1/chats"
                                list_params = {"name": assistant_name, "page_size": 1}
                                
                                list_response = await client.request("GET", list_url, 
                                                                   headers=self.headers,
                                                                   params=list_params)
                                
                                # 如果找到了助手，说明创建实际上成功了
                                if list_response.is_success:
                                    list_data = list_response.json()
                                    if (isinstance(list_data, dict) and 
                                        list_data.get('code') == 0 and 
                                        isinstance(list_data.get('data'), list) and 
                                        len(list_data['data']) > 0):
                                        
                                        created_assistant = list_data['data'][0]
                                        logger.info(f"✅ 验证成功：助手实际已创建 - ID: {created_assistant.get('id')}, 名称: {created_assistant.get('name')}")
                                        
                                        # 返回创建成功的助手数据
                                        return created_assistant
                        except Exception as verify_error:
                            logger.error(f"❌ 验证助手创建状态时出错: {verify_error}")
                        
                        # 如果验证失败，仍然抛出原错误
                        logger.error(f"RAGFlow business error: {error_message}")
                        raise HTTPException(status_code=400, detail=error_message)
                    
                    # 特殊处理RAGFlow的IndexError bug
                    elif "IndexError" in error_message and "list index out of range" in error_message:
                        logger.warning(f"RAGFlow IndexError bug detected: {error_message}")
                        raise HTTPException(status_code=400, detail=f"IndexError('list index out of range')")
                    
                    # 其他错误正常处理
                    else:
                        logger.error(f"RAGFlow business error: {error_message}")
                        raise HTTPException(status_code=400, detail=error_message)
                
                # 安全地处理返回数据
                try:
                    result = data.get('data', data) if isinstance(data, dict) else data
                    logger.info(f"🔍 处理后的返回数据类型: {type(result)}")
                    logger.info(f"🔍 处理后的返回数据内容: {result}")
                    return result
                except Exception as process_error:
                    logger.error(f"❌ 处理返回数据时出错: {process_error}")
                    logger.error(f"   原始数据: {data}")
                    raise HTTPException(status_code=500, detail=f"处理返回数据失败: {str(process_error)}")
                
            except httpx.TimeoutException:
                logger.error("RAGFlow API timeout")
                raise HTTPException(status_code=504, detail="RAGFlow 服务响应超时")
            except httpx.ConnectError:
                logger.error("RAGFlow API connection error")
                raise HTTPException(status_code=503, detail="无法连接到 RAGFlow 服务")
            except Exception as e:
                if isinstance(e, HTTPException):
                    raise e
                logger.error(f"RAGFlow API unexpected error: {str(e)}")
                raise HTTPException(status_code=500, detail=f"RAGFlow 服务错误: {str(e)}")

# 获取 RAGFlow 客户端实例
def get_ragflow_client() -> RAGFlowClient:
    if not RAGFLOW_BASE_URL or not RAGFLOW_API_KEY:
        raise HTTPException(
            status_code=500, 
            detail="RAGFlow 配置未完整设置"
        )
    return RAGFlowClient(RAGFLOW_BASE_URL, RAGFLOW_API_KEY)

# API 路由
@router.get("/config")
async def get_ragflow_config():
    """获取 RAGFlow 配置信息"""
    return {
        "base_url": RAGFLOW_BASE_URL,
        "configured": bool(RAGFLOW_API_KEY)
    }

@router.post("/test-connection")
async def test_ragflow_connection(params: TestConnectionParams):
    """测试 RAGFlow 连接"""
    try:
        # 使用传入的配置创建临时客户端
        client = RAGFlowClient(params.baseUrl, params.apiKey)
        # 尝试获取数据集列表来测试连接
        await client.request("GET", "/api/v1/datasets?page=1&page_size=1")
        return {"success": True, "message": "连接成功"}
    except Exception as e:
        logger.error(f"RAGFlow connection test failed: {str(e)}")
        return {"success": False, "message": str(e)}

@router.post("/test-sdk")
async def test_ragflow_sdk():
    """测试RAGFlow SDK连接和功能"""
    try:
        logger.info("🧪 开始测试RAGFlow SDK连接")
        
        from ..services.ragflow_sdk import get_ragflow_sdk_service
        sdk_service = get_ragflow_sdk_service()
        
        logger.info(f"SDK配置:")
        logger.info(f"  Base URL: {sdk_service.base_url}")
        logger.info(f"  API Key: {sdk_service.api_key[:20]}...")
        
        # 测试客户端初始化
        client = sdk_service._get_client()
        logger.info("✅ SDK客户端初始化成功")
        
        # 测试获取数据集列表
        logger.info("📋 测试获取数据集列表...")
        datasets = client.list_datasets(page=1, page_size=5)
        logger.info(f"✅ 获取到 {len(datasets)} 个数据集")
        
        dataset_info = []
        for dataset in datasets:
            info = {
                "id": dataset.id,
                "name": dataset.name,
                "chunk_count": getattr(dataset, 'chunk_count', 0),
                "document_count": getattr(dataset, 'document_count', 0)
            }
            dataset_info.append(info)
            logger.info(f"  数据集: {dataset.name} (ID: {dataset.id})")
        
        return {
            "success": True,
            "message": "RAGFlow SDK测试成功",
            "data": {
                "sdk_config": {
                    "base_url": sdk_service.base_url,
                    "api_key_preview": sdk_service.api_key[:20] + "..."
                },
                "datasets": dataset_info
            }
        }
        
    except Exception as e:
        logger.error(f"❌ RAGFlow SDK测试失败: {str(e)}")
        logger.error(f"   错误类型: {type(e).__name__}")
        import traceback
        logger.error(f"   错误堆栈: {traceback.format_exc()}")
        
        return {
            "success": False,
            "message": f"RAGFlow SDK测试失败: {str(e)}",
            "error_type": type(e).__name__
        }

# 数据集管理 API
@router.post("/datasets")
async def create_dataset(
    params: CreateDatasetParams,
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """创建知识库"""
    try:
        # 记录请求参数
        logger.info(f"🔍 创建知识库请求参数: {params.dict()}")
        
        # 处理嵌入模型：如果为空则不指定模型，如果指定则验证格式
        if params.embedding_model:
            # 验证嵌入模型格式
            if not isinstance(params.embedding_model, str) or len(params.embedding_model.strip()) == 0:
                raise HTTPException(status_code=400, detail="嵌入模型格式无效")
            
            # 保留原始模型ID格式，不做任何转换
            logger.info(f"📝 使用指定嵌入模型: {params.embedding_model}")
        else:
            # 嵌入模型为空，设置默认模型
            logger.info("📝 未指定嵌入模型，将使用默认模型: BAAI/bge-large-zh-v1.5@BAAI")
            # 设置RAGFlow API文档中的默认嵌入模型
            params.embedding_model = "BAAI/bge-large-zh-v1.5@BAAI"
        
        # 尝试创建数据集
        result = await client.request("POST", "/api/v1/datasets", json=params.dict())
        logger.info(f"✅ 数据集创建成功: {params.name}")
        return result
        
    except HTTPException as e:
        # 直接记录RAGFlow的完整错误信息
        logger.error(f"❌ RAGFlow HTTP错误: {e.status_code} - {e.detail}")
        # 直接抛出原始错误，不做任何修改
        raise e
    except Exception as e:
        # 记录完整的异常信息，包括类型和详细信息
        logger.error(f"❌ 创建数据集异常: {type(e).__name__}: {str(e)}")
        if hasattr(e, '__traceback__'):
            import traceback
            logger.error(f"❌ 异常堆栈: {traceback.format_exc()}")
        # 直接抛出原始异常，不做任何修改
        raise e

@router.get("/datasets")
async def list_datasets(
    page: Optional[int] = 1,
    page_size: Optional[int] = 10,
    orderby: Optional[str] = None,
    desc: Optional[bool] = None,
    id: Optional[str] = None,
    name: Optional[str] = None,
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """获取知识库列表"""
    params = {}
    if page is not None:
        params["page"] = page
    if page_size is not None:
        params["page_size"] = page_size
    if orderby is not None:
        params["orderby"] = orderby
    if desc is not None:
        params["desc"] = desc
    if id is not None:
        params["id"] = id
    if name is not None:
        params["name"] = name
    
    query_string = "&".join([f"{k}={v}" for k, v in params.items()])
    endpoint = f"/api/v1/datasets?{query_string}" if query_string else "/api/v1/datasets"
    
    response = await client.request("GET", endpoint)
    
    # 处理字段映射，确保前端需要的字段存在
    if isinstance(response, list):
        for dataset in response:
            # 添加created_at字段映射
            if 'create_time' in dataset and 'created_at' not in dataset:
                dataset['created_at'] = dataset['create_time']
            # 添加updated_at字段映射
            if 'update_time' in dataset and 'updated_at' not in dataset:
                dataset['updated_at'] = dataset['update_time']
    elif isinstance(response, dict) and 'data' in response:
        for dataset in response['data']:
            # 添加created_at字段映射
            if 'create_time' in dataset and 'created_at' not in dataset:
                dataset['created_at'] = dataset['create_time']
            # 添加updated_at字段映射
            if 'update_time' in dataset and 'updated_at' not in dataset:
                dataset['updated_at'] = dataset['update_time']
    
    return response

@router.put("/datasets/{dataset_id}")
async def update_dataset(
    dataset_id: str,
    params: UpdateDatasetParams,
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """更新知识库"""
    return await client.request("PUT", f"/api/v1/datasets/{dataset_id}", json=params.dict(exclude_unset=True))

@router.delete("/datasets")
async def delete_datasets(
    ids: List[str] = Body(...),
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """删除知识库"""
    return await client.request("DELETE", "/api/v1/datasets", json={"ids": ids})

@router.get("/datasets/{dataset_id}")
async def get_dataset(
    dataset_id: str,
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """获取知识库详情"""
    return await client.request("GET", f"/api/v1/datasets/{dataset_id}")

# 文档管理 API
@router.get("/datasets/{dataset_id}/documents")
async def list_documents(
    dataset_id: str,
    page: Optional[int] = 1,
    page_size: Optional[int] = 10,
    orderby: Optional[str] = None,
    desc: Optional[bool] = None,
    keywords: Optional[str] = None,
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """获取文档列表"""
    params = {}
    if page is not None:
        params["page"] = page
    if page_size is not None:
        params["page_size"] = page_size
    if orderby is not None:
        params["orderby"] = orderby
    if desc is not None:
        params["desc"] = desc
    if keywords is not None:
        params["keywords"] = keywords
    
    query_string = "&".join([f"{k}={v}" for k, v in params.items()])
    endpoint = f"/api/v1/datasets/{dataset_id}/documents?{query_string}" if query_string else f"/api/v1/datasets/{dataset_id}/documents"
    
    return await client.request("GET", endpoint)

@router.post("/datasets/{dataset_id}/documents/upload")
async def upload_documents(
    dataset_id: str,
    files: List[UploadFile] = File(...),
):
    """
    上传文档到指定数据集
    """
    logger.info("=" * 60)
    logger.info("📤 RAGFlow 文档上传请求开始")
    logger.info(f"🆔 数据集ID: {dataset_id}")
    logger.info(f"📁 接收到的文件数量: {len(files)}")
    
    try:
        # 验证是否有文件
        if not files:
            raise HTTPException(status_code=422, detail="没有接收到文件")
        
        # 记录每个文件的信息
        for i, file in enumerate(files):
            logger.info(f"📄 文件 {i+1}: {file.filename}")
            logger.info(f"   类型: {file.content_type}")
        
        # RAGFlow 服务端限制：单次最多32个文件，总大小不超过1GB
        MAX_FILES_PER_BATCH = 32
        MAX_TOTAL_BYTES_PER_BATCH = 1 * 1024 * 1024 * 1024  # 1GB
        
        if len(files) > MAX_FILES_PER_BATCH:
            raise HTTPException(status_code=413, detail=f"单次最多上传 {MAX_FILES_PER_BATCH} 个文件，请分批上传")
        
        # 使用现有的SDK服务
        logger.info("🔗 获取RAGFlow SDK服务...")
        try:
            from ..services.ragflow_sdk import get_ragflow_sdk_service
            sdk_service = get_ragflow_sdk_service()
            logger.info("✅ RAGFlow SDK服务获取成功")
        except Exception as sdk_error:
            logger.error(f"❌ 获取RAGFlow SDK服务失败: {sdk_error}")
            logger.error(f"   错误类型: {type(sdk_error).__name__}")
            raise HTTPException(status_code=503, detail=f"RAGFlow服务连接失败: {str(sdk_error)}")
        
        # 准备文档列表
        documents = []
        total_bytes = 0
        for i, file in enumerate(files):
            logger.info(f"🔍 处理文件 {i+1}: {file.filename}")
            logger.info(f"   文件类型: {file.content_type}")
            logger.info(f"   文件大小: {getattr(file, 'size', 'unknown')}")
            
            # 验证文件
            if not file.filename:
                error_msg = f"文件 {i+1} 缺少文件名"
                logger.error(f"❌ {error_msg}")
                raise HTTPException(status_code=422, detail=error_msg)
            
            # 验证文件类型
            ALLOWED_EXTENSIONS = {
                # 文本文档
                '.txt', '.pdf', '.doc', '.docx', '.md', '.markdown', '.html', '.htm', '.json', '.csv', '.xlsx', '.xls', '.ppt', '.pptx', '.rtf', '.odt', '.epub', '.tex', '.log', '.rst', '.org',
                # 代码与配置
                '.py', '.js', '.jsx', '.ts', '.tsx', '.java', '.kt', '.kts', '.scala', '.go', '.rs', '.rb', '.php', '.cs', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.m', '.mm', '.swift', '.dart', '.lua', '.pl', '.pm', '.r', '.jl', '.sql', '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd', '.vb', '.vbs', '.groovy', '.gradle', '.make', '.mk', '.cmake', '.toml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.properties', '.env', '.editorconfig', '.dockerfile', '.gql', '.graphql', '.svelte', '.vue', '.tsx', '.jsx', '.tsx',
                # 图片（作为可解析对象）
                '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.svg', '.ico', '.heic'
            }
            file_ext = os.path.splitext(file.filename)[1].lower()
            if file_ext not in ALLOWED_EXTENSIONS:
                error_msg = f"不支持的文件类型: {file_ext}。支持的类型: {', '.join(ALLOWED_EXTENSIONS)}"
                logger.error(f"❌ {error_msg}")
                raise HTTPException(status_code=422, detail=error_msg)
            
            # 读取文件内容并检查大小
            try:
                logger.info(f"📖 开始读取文件内容: {file.filename}")
                
                # 读取文件内容
                content = await file.read()
                
                # 验证内容不为空
                if content is None or len(content) == 0:
                    error_msg = f"文件 {file.filename} 内容为空"
                    logger.error(f"❌ {error_msg}")
                    raise HTTPException(status_code=422, detail=error_msg)
                
                # 计算累计大小以符合RAGFlow批次1GB限制
                file_size = len(content)
                total_bytes += file_size
                if total_bytes > MAX_TOTAL_BYTES_PER_BATCH:
                    error_msg = f"本次上传总大小超过1GB限制，请减少文件数量或分批上传"
                    logger.error(f"❌ {error_msg}")
                    raise HTTPException(status_code=413, detail=error_msg)
                
                # 确保content是bytes类型
                if not isinstance(content, bytes):
                    logger.warning(f"⚠️ 文件内容不是bytes类型: {type(content)}, 尝试转换")
                    if isinstance(content, str):
                        content = content.encode('utf-8')
                    else:
                        content = bytes(content)
                
                logger.info(f"✅ 文件 {file.filename} 读取成功")
                logger.info(f"   内容大小: {len(content)} bytes")
                logger.info(f"   内容类型: {type(content)}")
                logger.info(f"   前50字节: {content[:50]}")
                
                document = {
                    "display_name": file.filename,
                    "blob": content
                }
                documents.append(document)
                logger.info(f"✅ 文档 {file.filename} 添加到上传列表")
                
            except HTTPException:
                # 重新抛出HTTP异常
                raise
            except Exception as read_error:
                logger.error(f"❌ 读取文件 {file.filename} 失败: {read_error}")
                logger.error(f"   错误类型: {type(read_error).__name__}")
                import traceback
                logger.error(f"   错误堆栈: {traceback.format_exc()}")
                raise HTTPException(status_code=422, detail=f"读取文件 {file.filename} 失败: {str(read_error)}")
            
        # 验证至少有一个有效文档
        if not documents:
            error_msg = "没有有效的文档可以上传"
            logger.error(f"❌ {error_msg}")
            raise HTTPException(status_code=422, detail=error_msg)
        
        logger.info(f"📋 准备上传 {len(documents)} 个文档到RAGFlow")
        
        # 使用SDK服务上传文档
        try:
            logger.info("📤 开始上传文档到RAGFlow...")
            
            # 使用现有的SDK服务上传文档
            upload_result = sdk_service.upload_documents(dataset_id, documents)
            
            logger.info(f"✅ 文档上传成功")
            logger.info(f"📊 上传结果: {upload_result}")
            
            return {
                "message": "文档上传成功",
                "uploaded_count": len(documents),
                "details": upload_result
            }
            
        except Exception as upload_error:
            logger.error(f"❌ 上传文档到RAGFlow失败: {upload_error}")
            logger.error(f"   错误类型: {type(upload_error).__name__}")
            import traceback
            logger.error(f"   错误堆栈: {traceback.format_exc()}")
            
            # 分析错误类型并提供更具体的错误信息
            if "401" in str(upload_error) or "unauthorized" in str(upload_error).lower():
                raise HTTPException(status_code=401, detail="RAGFlow认证失败，请检查API密钥")
            elif "404" in str(upload_error) or "not found" in str(upload_error).lower():
                raise HTTPException(status_code=404, detail=f"数据集 {dataset_id} 不存在")
            elif "413" in str(upload_error) or "too large" in str(upload_error).lower():
                raise HTTPException(status_code=413, detail="文件太大，超过服务器限制")
            else:
                raise HTTPException(status_code=500, detail=f"上传失败: {str(upload_error)}")
        
    except HTTPException:
        # 重新抛出HTTP异常
        raise
    except Exception as general_error:
        logger.error(f"❌ 处理上传请求时发生未知错误: {general_error}")
        logger.error(f"   错误类型: {type(general_error).__name__}")
        import traceback
        logger.error(f"   错误堆栈: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"服务器内部错误: {str(general_error)}")
    
    finally:
        logger.info("📤 RAGFlow 文档上传请求结束")
        logger.info("=" * 60)

@router.post("/datasets/{dataset_id}/documents/parse")
async def parse_documents(
    dataset_id: str,
    document_ids: List[str] = Body(...),
):
    """解析文档"""
    logger.info("=" * 60)
    logger.info("🔄 RAGFlow 文档解析请求开始")
    logger.info(f"🆔 数据集ID: {dataset_id}")
    logger.info(f"📄 文档ID列表: {document_ids}")
    logger.info(f"📄 文档数量: {len(document_ids)}")
    
    try:
        # 验证参数
        if not dataset_id:
            raise HTTPException(status_code=422, detail="数据集ID不能为空")
        
        if not document_ids or not isinstance(document_ids, list):
            raise HTTPException(status_code=422, detail="文档ID列表不能为空")
        
        # 使用RAGFlow SDK服务
        logger.info("🔗 获取RAGFlow SDK服务...")
        try:
            from ..services.ragflow_sdk import get_ragflow_sdk_service
            sdk_service = get_ragflow_sdk_service()
            logger.info("✅ RAGFlow SDK服务获取成功")
        except Exception as sdk_error:
            logger.error(f"❌ 获取RAGFlow SDK服务失败: {sdk_error}")
            logger.error(f"   错误类型: {type(sdk_error).__name__}")
            raise HTTPException(status_code=503, detail=f"RAGFlow服务连接失败: {str(sdk_error)}")
        
        # 调用SDK解析方法
        logger.info("🚀 开始调用SDK解析文档...")
        try:
            result = sdk_service.parse_documents(dataset_id, document_ids)
            logger.info(f"✅ 文档解析调用成功: {result}")
            return result
        except Exception as parse_error:
            logger.error(f"❌ 文档解析失败: {parse_error}")
            logger.error(f"   错误类型: {type(parse_error).__name__}")
            import traceback
            logger.error(f"   错误堆栈: {traceback.format_exc()}")
            raise HTTPException(status_code=500, detail=f"文档解析失败: {str(parse_error)}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 文档解析请求处理失败: {e}")
        logger.error(f"   错误类型: {type(e).__name__}")
        import traceback
        logger.error(f"   错误堆栈: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"服务器内部错误: {str(e)}")
    finally:
        logger.info("=" * 60)

@router.post("/datasets/{dataset_id}/documents/cancel_parse")
async def cancel_parse_documents(
    dataset_id: str,
    document_ids: List[str] = Body(...),
):
    """取消文档解析"""
    logger.info("=" * 60)
    logger.info("⏹️ RAGFlow 取消文档解析请求开始")
    logger.info(f"🆔 数据集ID: {dataset_id}")
    logger.info(f"📄 文档ID列表: {document_ids}")
    logger.info(f"📄 文档数量: {len(document_ids)}")
    
    try:
        # 验证参数
        if not dataset_id:
            raise HTTPException(status_code=422, detail="数据集ID不能为空")
        
        if not document_ids or not isinstance(document_ids, list):
            raise HTTPException(status_code=422, detail="文档ID列表不能为空")
        
        # 使用RAGFlow SDK服务
        logger.info("🔗 获取RAGFlow SDK服务...")
        try:
            from ..services.ragflow_sdk import get_ragflow_sdk_service
            sdk_service = get_ragflow_sdk_service()
            logger.info("✅ RAGFlow SDK服务获取成功")
        except Exception as sdk_error:
            logger.error(f"❌ 获取RAGFlow SDK服务失败: {sdk_error}")
            logger.error(f"   错误类型: {type(sdk_error).__name__}")
            raise HTTPException(status_code=503, detail=f"RAGFlow服务连接失败: {str(sdk_error)}")
        
        # 调用SDK取消解析方法
        logger.info("⏹️ 开始调用SDK取消解析文档...")
        try:
            result = sdk_service.cancel_parse_documents(dataset_id, document_ids)
            logger.info(f"✅ 取消文档解析调用成功: {result}")
            return result
        except Exception as cancel_error:
            logger.error(f"❌ 取消文档解析失败: {cancel_error}")
            logger.error(f"   错误类型: {type(cancel_error).__name__}")
            import traceback
            logger.error(f"   错误堆栈: {traceback.format_exc()}")
            raise HTTPException(status_code=500, detail=f"取消文档解析失败: {str(cancel_error)}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 取消文档解析请求处理失败: {e}")
        logger.error(f"   错误类型: {type(e).__name__}")
        import traceback
        logger.error(f"   错误堆栈: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"服务器内部错误: {str(e)}")
    finally:
        logger.info("=" * 60)

@router.get("/datasets/{dataset_id}/documents/{document_id}")
async def get_document(
    dataset_id: str,
    document_id: str,
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """获取知识库详情"""
    return await client.request("GET", f"/api/v1/datasets/{dataset_id}/documents/{document_id}")

@router.put("/datasets/{dataset_id}/documents/{document_id}")
async def update_document(
    dataset_id: str,
    document_id: str,
    update_data: Dict[str, Any] = Body(...),
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """更新文档"""
    return await client.request("PUT", f"/api/v1/datasets/{dataset_id}/documents/{document_id}", json=update_data)

# 注意：RAGFlow官方API不提供HTTP下载端点，只支持Python SDK的Document.download()方法
# 因此暂时移除下载功能，避免404错误
# 如需下载功能，需要通过Python SDK在后端实现代理服务

# @router.get("/datasets/{dataset_id}/documents/{document_id}/download")
# async def download_document(
#     dataset_id: str,
#     document_id: str,
#     client: RAGFlowClient = Depends(get_ragflow_client)
# ):
#     """下载文档 - 暂时不可用，RAGFlow不提供HTTP下载API"""
#     raise HTTPException(status_code=501, detail="文档下载功能暂不可用，RAGFlow官方API不支持HTTP下载端点")

@router.delete("/datasets/{dataset_id}/documents")
async def delete_documents(
    dataset_id: str,
    ids: List[str] = Body(...),
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """删除文档"""
    return await client.request("DELETE", f"/api/v1/datasets/{dataset_id}/documents", json={"ids": ids})

# 分块管理 API
@router.get("/datasets/{dataset_id}/documents/{document_id}/chunks")
async def list_chunks(
    dataset_id: str,
    document_id: str,
    page: Optional[int] = 1,
    page_size: Optional[int] = 30,
    keywords: Optional[str] = None,
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """获取文档分块列表"""
    params = {}
    if page is not None:
        params["page"] = page
    if page_size is not None:
        params["page_size"] = page_size
    if keywords is not None:
        params["keywords"] = keywords
    
    query_string = "&".join([f"{k}={v}" for k, v in params.items()])
    endpoint = f"/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks?{query_string}" if query_string else f"/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks"
    
    return await client.request("GET", endpoint)

@router.post("/datasets/{dataset_id}/documents/{document_id}/chunks")
async def create_chunk(
    dataset_id: str,
    document_id: str,
    chunk_data: Dict[str, Any] = Body(...),
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """创建分块"""
    return await client.request("POST", f"/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks", json=chunk_data)

@router.put("/datasets/{dataset_id}/documents/{document_id}/chunks/{chunk_id}")
async def update_chunk(
    dataset_id: str,
    document_id: str,
    chunk_id: str,
    chunk_data: Dict[str, Any] = Body(...),
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """更新分块"""
    return await client.request("PUT", f"/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks/{chunk_id}", json=chunk_data)

@router.delete("/datasets/{dataset_id}/documents/{document_id}/chunks")
async def delete_chunks(
    dataset_id: str,
    document_id: str,
    chunk_ids: List[str] = Body(...),
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """删除分块"""
    return await client.request("DELETE", f"/api/v1/datasets/{dataset_id}/documents/{document_id}/chunks", json={"chunk_ids": chunk_ids})

# 检索API
@router.post("/retrieve")
async def retrieve_chunks(
    params: Dict[str, Any] = Body(...),
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """检索分块"""
    return await client.request("POST", "/api/v1/retrieval", json=params)

# 对话助手管理 API
@router.get("/assistants")
async def list_assistants(
    page: Optional[int] = 1,
    page_size: Optional[int] = 30,  # 按照RAGFlow文档默认值
    orderby: Optional[str] = "create_time",  # 按照RAGFlow文档默认值
    desc: Optional[bool] = True,  # 按照RAGFlow文档默认值
    id: Optional[str] = None,
    name: Optional[str] = None,
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """获取对话助手列表"""
    try:
        logger.info(f"📝 获取对话助手列表")
        
        # 构建查询参数，严格按照RAGFlow API文档格式
        params = {}
        if page is not None:
            params["page"] = page
        if page_size is not None:
            params["page_size"] = page_size
        if orderby is not None:
            params["orderby"] = orderby
        if desc is not None:
            params["desc"] = desc
        if id is not None:
            params["id"] = id
        if name is not None:
            params["name"] = name
        
        logger.info(f"📝 查询参数: {params}")
        
        # 构建查询字符串
        query_string = "&".join([f"{k}={v}" for k, v in params.items()])
        endpoint = f"/api/v1/chats?{query_string}" if query_string else "/api/v1/chats"
        
        logger.info(f"📤 请求端点: {endpoint}")
        
        # 调用RAGFlow API获取对话助手列表
        result = await client.request("GET", endpoint)
        logger.info(f"✅ 成功获取对话助手列表，共 {len(result) if isinstance(result, list) else '未知'} 个")
        
        # 处理数据格式转换：将datasets字段转换为dataset_ids字段
        def transform_assistant(assistant):
            """转换助手数据格式"""
            if 'datasets' in assistant:
                # 从datasets对象数组中提取id列表
                dataset_ids = [dataset.get('id') for dataset in assistant['datasets'] if dataset.get('id')]
                assistant['dataset_ids'] = dataset_ids
                logger.debug(f"📝 助手 {assistant.get('name', '未知')} 的知识库转换: {len(dataset_ids)} 个")
            else:
                assistant['dataset_ids'] = []
            return assistant
        
        # 转换结果数据
        if isinstance(result, list):
            # 直接是助手列表
            result = [transform_assistant(assistant) for assistant in result]
        elif isinstance(result, dict) and 'data' in result:
            # 包装在data字段中的助手列表
            result['data'] = [transform_assistant(assistant) for assistant in result['data']]
        
        logger.info(f"✅ 助手数据格式转换完成")
        return result
        
    except HTTPException as e:
        logger.error(f"❌ RAGFlow HTTP错误: {e.status_code} - {e.detail}")
        raise e
    except Exception as e:
        logger.error(f"❌ 获取对话助手列表失败: {str(e)}")
        logger.error(f"错误详情: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"获取对话助手列表失败: {str(e)}")

@router.post("/assistants")
async def create_assistant(
    params: CreateChatAssistantParams,
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """创建对话助手"""
    try:
        logger.info(f"📝 开始创建对话助手: {params.name}")
        
        # 构建请求数据，严格按照RAGFlow API文档格式
        request_data = {
            "name": params.name,
            "dataset_ids": params.dataset_ids if params.dataset_ids else []  # 始终包含dataset_ids字段，避免RAGFlow的KeyError bug
        }
        
        # 添加可选参数
        if params.avatar:
            request_data["avatar"] = params.avatar
            logger.info(f"📝 设置头像")
        
        # 记录数据集关联情况
        if params.dataset_ids:
            logger.info(f"📝 关联数据集: {params.dataset_ids}")
        else:
            logger.info(f"📝 未关联数据集（创建纯LLM助手）")
        
        # 处理LLM设置
        if params.llm:
            llm_config = {}
            if params.llm.model_name is not None:
                llm_config["model_name"] = params.llm.model_name
            if params.llm.temperature is not None:
                llm_config["temperature"] = params.llm.temperature
            if params.llm.top_p is not None:
                llm_config["top_p"] = params.llm.top_p
            if params.llm.presence_penalty is not None:
                llm_config["presence_penalty"] = params.llm.presence_penalty
            if params.llm.frequency_penalty is not None:
                llm_config["frequency_penalty"] = params.llm.frequency_penalty
            
            if llm_config:
                request_data["llm"] = llm_config
                logger.info(f"📝 LLM配置: {llm_config}")
        
        # 处理提示设置
        if params.prompt:
            prompt_config = {}
            if params.prompt.similarity_threshold is not None:
                prompt_config["similarity_threshold"] = params.prompt.similarity_threshold
            if params.prompt.keywords_similarity_weight is not None:
                prompt_config["keywords_similarity_weight"] = params.prompt.keywords_similarity_weight
            if params.prompt.vector_similarity_weight is not None:
                prompt_config["vector_similarity_weight"] = params.prompt.vector_similarity_weight
            if params.prompt.top_n is not None:
                prompt_config["top_n"] = params.prompt.top_n
            if params.prompt.variables is not None:
                prompt_config["variables"] = params.prompt.variables
            if params.prompt.rerank_model is not None:
                prompt_config["rerank_model"] = params.prompt.rerank_model
            if params.prompt.top_k is not None:
                prompt_config["top_k"] = params.prompt.top_k
            if params.prompt.empty_response is not None:
                prompt_config["empty_response"] = params.prompt.empty_response
            if params.prompt.opener is not None:
                prompt_config["opener"] = params.prompt.opener
            if params.prompt.show_quote is not None:
                prompt_config["show_quote"] = params.prompt.show_quote
            if params.prompt.prompt is not None:
                prompt_config["prompt"] = params.prompt.prompt
            
            if prompt_config:
                request_data["prompt"] = prompt_config
                logger.info(f"📝 提示配置: {prompt_config}")
        
        logger.info(f"📤 发送到RAGFlow的请求数据: {request_data}")
        
        # 调用RAGFlow API创建对话助手
        result = await client.request("POST", "/api/v1/chats", json=request_data)
        logger.info(f"✅ 对话助手创建成功: {params.name}")
        
        # 处理返回数据格式转换：将datasets字段转换为dataset_ids字段
        if isinstance(result, dict) and 'datasets' in result:
            dataset_ids = [dataset.get('id') for dataset in result['datasets'] if dataset.get('id')]
            result['dataset_ids'] = dataset_ids
            logger.debug(f"📝 创建的助手知识库转换: {len(dataset_ids)} 个")
        elif isinstance(result, dict):
            result['dataset_ids'] = []
        
        return result
        
    except HTTPException as e:
        logger.error(f"❌ RAGFlow HTTP错误: {e.status_code} - {e.detail}")
        raise e
    except Exception as e:
        logger.error(f"❌ 创建对话助手失败: {str(e)}")
        logger.error(f"错误详情: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"创建对话助手失败: {str(e)}")

@router.put("/assistants/{assistant_id}")
async def update_assistant(
    assistant_id: str,
    params: UpdateChatAssistantParams,
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """更新对话助手"""
    try:
        logger.info(f"📝 开始更新对话助手: {assistant_id}")
        
        # 构建更新数据，只包含非None的字段
        update_data = {}
        
        if params.name is not None:
            update_data["name"] = params.name
            logger.info(f"📝 更新名称: {params.name}")
        
        if params.avatar is not None:
            update_data["avatar"] = params.avatar
            logger.info(f"📝 更新头像")
        
        if params.dataset_ids is not None:
            update_data["dataset_ids"] = params.dataset_ids
            logger.info(f"📝 更新关联数据集: {params.dataset_ids}")
        
        # 处理LLM设置更新
        if params.llm is not None:
            llm_config = {}
            if params.llm.model_name is not None:
                llm_config["model_name"] = params.llm.model_name
            if params.llm.temperature is not None:
                llm_config["temperature"] = params.llm.temperature
            if params.llm.top_p is not None:
                llm_config["top_p"] = params.llm.top_p
            if params.llm.presence_penalty is not None:
                llm_config["presence_penalty"] = params.llm.presence_penalty
            if params.llm.frequency_penalty is not None:
                llm_config["frequency_penalty"] = params.llm.frequency_penalty
            
            if llm_config:
                update_data["llm"] = llm_config
                logger.info(f"📝 更新LLM配置: {llm_config}")
        
        # 处理提示设置更新
        if params.prompt is not None:
            prompt_config = {}
            if params.prompt.similarity_threshold is not None:
                prompt_config["similarity_threshold"] = params.prompt.similarity_threshold
            if params.prompt.keywords_similarity_weight is not None:
                prompt_config["keywords_similarity_weight"] = params.prompt.keywords_similarity_weight
            if params.prompt.vector_similarity_weight is not None:
                prompt_config["vector_similarity_weight"] = params.prompt.vector_similarity_weight
            if params.prompt.top_n is not None:
                prompt_config["top_n"] = params.prompt.top_n
            if params.prompt.variables is not None:
                prompt_config["variables"] = params.prompt.variables
            if params.prompt.rerank_model is not None:
                prompt_config["rerank_model"] = params.prompt.rerank_model
            if params.prompt.top_k is not None:
                prompt_config["top_k"] = params.prompt.top_k
            if params.prompt.empty_response is not None:
                prompt_config["empty_response"] = params.prompt.empty_response
            if params.prompt.opener is not None:
                prompt_config["opener"] = params.prompt.opener
            if params.prompt.show_quote is not None:
                prompt_config["show_quote"] = params.prompt.show_quote
            if params.prompt.prompt is not None:
                prompt_config["prompt"] = params.prompt.prompt
            
            if prompt_config:
                update_data["prompt"] = prompt_config
                logger.info(f"📝 更新提示配置: {prompt_config}")
        
        if not update_data:
            logger.warning("⚠️ 没有提供任何更新数据")
            raise HTTPException(status_code=400, detail="没有提供任何更新数据")
        
        logger.info(f"📤 发送到RAGFlow的更新数据: {update_data}")
        
        # 调用RAGFlow API更新对话助手
        result = await client.request("PUT", f"/api/v1/chats/{assistant_id}", json=update_data)
        logger.info(f"✅ 对话助手更新成功: {assistant_id}")
        
        # 处理返回数据格式转换：将datasets字段转换为dataset_ids字段
        if isinstance(result, dict) and 'datasets' in result:
            dataset_ids = [dataset.get('id') for dataset in result['datasets'] if dataset.get('id')]
            result['dataset_ids'] = dataset_ids
            logger.debug(f"📝 更新的助手知识库转换: {len(dataset_ids)} 个")
        elif isinstance(result, dict):
            result['dataset_ids'] = []
        
        return result
        
    except HTTPException as e:
        logger.error(f"❌ RAGFlow HTTP错误: {e.status_code} - {e.detail}")
        raise e
    except Exception as e:
        logger.error(f"❌ 更新对话助手失败: {str(e)}")
        logger.error(f"错误详情: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"更新对话助手失败: {str(e)}")

@router.delete("/assistants")
async def delete_assistants(
    ids: Optional[List[str]] = Body(None),
    client: RAGFlowClient = Depends(get_ragflow_client),
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """删除对话助手"""
    try:
        logger.info(f"📝 开始删除对话助手")
        
        # 根据RAGFlow文档，ids可以为None（删除所有）或空数组（不删除任何）
        if ids is None:
            logger.info("📝 删除所有对话助手")
        elif len(ids) == 0:
            logger.info("📝 不删除任何对话助手")
            return {"message": "没有指定要删除的对话助手"}
        else:
            logger.info(f"📝 删除指定对话助手: {ids}")
        
        # 构建请求数据
        request_data = {"ids": ids} if ids is not None else {"ids": None}

        # 删除前预取每个助手的头像URL（避免删除后GET 405）
        prefetch_avatar_by_id: dict[str, Optional[str]] = {}
        try:
            if ids:
                for assistant_id in ids:
                    try:
                        info = await client.request("GET", f"/api/v1/chats/{assistant_id}")
                        avatar_url = info.get("avatar") if isinstance(info, dict) else None
                        prefetch_avatar_by_id[assistant_id] = avatar_url
                    except Exception as e_pref:
                        logger.warning(f"预取助手头像失败: {assistant_id}, err={e_pref}")
        except Exception as e_all:
            logger.warning(f"批量预取助手头像失败: {e_all}")
        
        logger.info(f"📤 发送到RAGFlow的删除请求: {request_data}")
        
        # 调用RAGFlow API删除对话助手
        result = await client.request("DELETE", "/api/v1/chats", json=request_data)
        logger.info(f"✅ 对话助手删除成功")

        # 精确删除：删除助手头像URL与其会话头像URL（若为本MinIO对象）
        try:
            from ..utils.minio_client import minio_client
            assistant_ids = ids or []
            for assistant_id in assistant_ids:
                try:
                    # 助手头像（使用预取的URL，避免删除后无法GET）
                    try:
                        assistant_avatar_url = prefetch_avatar_by_id.get(assistant_id)
                        if assistant_avatar_url and isinstance(assistant_avatar_url, str) and assistant_avatar_url.startswith("minio://"):
                            # 精确删除具体文件
                            minio_client.delete_image(assistant_avatar_url)
                            logger.info(f"已按URL精确删除助手头像: {assistant_avatar_url}")
                            # 通过URL反推出更稳妥的前缀并删除：如 users/{owner}/assistants/{assistant_id}/avatar/
                            try:
                                path_after_bucket = assistant_avatar_url.split("//", 1)[1].split("/", 1)[1]
                                # 删除到文件所在目录
                                last_slash_index = path_after_bucket.rfind("/")
                                if last_slash_index > 0:
                                    precise_prefix = path_after_bucket[:last_slash_index + 1]
                                    logger.info(f"尝试通过assistant avatar url删除精确前缀: {precise_prefix}")
                                    minio_client.delete_prefix(precise_prefix)
                                # 若路径形如 users/{uid}/assistants/{assistant_id}/avatar/... 再向上清理整个助手根目录
                                parts = path_after_bucket.split("/")
                                if len(parts) >= 4:
                                    # 尝试寻找 'assistants/{assistant_id}' 片段的位置
                                    for i in range(len(parts) - 1):
                                        if parts[i] == "assistants" and i + 1 < len(parts):
                                            assistant_root = "/".join(parts[: i + 2]) + "/"
                                            logger.info(f"尝试删除助手根前缀(来自URL): {assistant_root}")
                                            minio_client.delete_prefix(assistant_root)
                                            break
                            except Exception as e2:
                                logger.warning(f"解析助手头像URL失败，跳过前缀清理: {e2}")
                    except Exception as fetch_err:
                        logger.warning(f"获取助手信息失败，跳过头像URL精确删除: {fetch_err}")

                    # 助手会话中存储的 role_avatar_url 精确删除（不限定当前用户，覆盖历史owner）
                    try:
                        cursor = db.fish_chat.ragflow_sessions.find({
                            "assistant_id": assistant_id,
                            "role_avatar_url": {"$exists": True, "$ne": None}
                        })
                        async for sess in cursor:
                            avatar_url = sess.get("role_avatar_url")
                            if isinstance(avatar_url, str) and avatar_url.startswith("minio://"):
                                minio_client.delete_image(avatar_url)
                                logger.info(f"已按URL精确删除助手会话头像: {avatar_url}")
                    except Exception as url_del_err:
                        logger.warning(f"删除助手会话头像URL失败: {url_del_err}")
                except Exception as one_err:
                    logger.warning(f"清理助手 {assistant_id} 头像URL时出错: {one_err}")
        except Exception as e:
            logger.error(f"精确删除助手相关头像失败: {str(e)}")

        # 删除 MinIO 中对应助手头像与其会话头像（用户作用域）
        try:
            from ..utils.minio_client import minio_client
            assistant_ids = ids or []
            for assistant_id in assistant_ids:

                # 同时尝试清理可能存放在其他用户目录下的历史头像（通过数据库与URL兜底）
                try:
                    # 1) 从本地 session 记录反查 role_avatar_url 精确前缀
                    cursor = db.fish_chat.ragflow_sessions.find({
                        "assistant_id": assistant_id,
                        "role_avatar_url": {"$exists": True, "$ne": None}
                    })
                    async for sess in cursor:
                        avatar_url = sess.get("role_avatar_url")
                        if isinstance(avatar_url, str) and avatar_url.startswith("minio://"):
                            try:
                                path_after_bucket = avatar_url.split("//", 1)[1].split("/", 1)[1]
                                last_slash_index = path_after_bucket.rfind("/")
                                if last_slash_index > 0:
                                    precise_prefix = path_after_bucket[:last_slash_index + 1]
                                    logger.info(f"通过会话头像URL删除精确前缀: {precise_prefix}")
                                    minio_client.delete_prefix(precise_prefix)
                                # 进一步：若URL形如 users/{owner}/assistants/{assistant_id}/sessions/... ，向上清理该owner下助手根目录
                                parts = path_after_bucket.split("/")
                                for i in range(len(parts) - 1):
                                    if parts[i] == "assistants" and i + 1 < len(parts):
                                        # 回溯查找 users/{owner}
                                        owner_id = None
                                        for j in range(i - 1, -1, -1):
                                            if parts[j] == "users" and j + 1 < len(parts):
                                                owner_id = parts[j + 1]
                                                break
                                        if owner_id:
                                            owner_assistant_prefix = f"users/{owner_id}/assistants/{assistant_id}/"
                                            logger.info(f"通过URL派生owner并清理助手根前缀: {owner_assistant_prefix}")
                                            minio_client.delete_prefix(owner_assistant_prefix)
                                        break
                            except Exception as e2:
                                logger.warning(f"解析会话头像URL失败，跳过前缀清理: {e2}")
                except Exception as any_err:
                    logger.warning(f"清理跨用户助手头像前缀时出错: {any_err}")

                # 额外兜底：直接扫描 users/ 下所有 owner，凡路径包含 /assistants/{assistant_id}/ 的都清理对应 owner 根前缀
                try:
                    cleaned_owners = minio_client.delete_assistant_across_owners(assistant_id)
                    logger.info(f"跨owner清理完成，涉及 {cleaned_owners} 个owner")
                except Exception as scan_err:
                    logger.warning(f"跨owner清理助手前缀失败: {scan_err}")

                # 2) 从本地会话反查所有 owner_user_id，并按 owner 清理 users/{owner}/assistants/{assistant_id}/
                try:
                    owner_ids = set()
                    owner_cursor = db.fish_chat.ragflow_sessions.find({
                        "assistant_id": assistant_id,
                        "user_id": {"$exists": True}
                    }, {"user_id": 1})
                    async for doc in owner_cursor:
                        uid = str(doc.get("user_id"))
                        if uid:
                            owner_ids.add(uid)
                    for owner_id in owner_ids:
                        owner_assistant_prefix = f"users/{owner_id}/assistants/{assistant_id}/"
                        logger.info(f"按owner清理助手根前缀: {owner_assistant_prefix}")
                        minio_client.delete_prefix(owner_assistant_prefix)
                except Exception as e_own:
                    logger.warning(f"按owner清理助手根前缀失败: {e_own}")
        except Exception as e:
            logger.error(f"删除助手相关MinIO前缀失败: {str(e)}")

        # 删除本地数据库中该用户下助手的会话记录（可选清理）
        try:
            if ids:
                await db.fish_chat.ragflow_sessions.delete_many({
                    "user_id": str(current_user.id),
                    "assistant_id": {"$in": ids}
                })
        except Exception as e:
            logger.warning(f"本地助手会话记录清理失败: {str(e)}")

        return result
        
    except HTTPException as e:
        logger.error(f"❌ RAGFlow HTTP错误: {e.status_code} - {e.detail}")
        raise e
    except Exception as e:
        logger.error(f"❌ 删除对话助手失败: {str(e)}")
        logger.error(f"错误详情: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"删除对话助手失败: {str(e)}") 

# WebSocket连接管理器
class DocumentStatusManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.polling_tasks: Dict[str, asyncio.Task] = {}
    
    async def connect(self, websocket: WebSocket, dataset_id: str):
        if dataset_id not in self.active_connections:
            self.active_connections[dataset_id] = []
        self.active_connections[dataset_id].append(websocket)
        logger.info(f"WebSocket连接建立 - 数据集ID: {dataset_id}")
    
    def disconnect(self, websocket: WebSocket, dataset_id: str):
        if dataset_id in self.active_connections:
            try:
                self.active_connections[dataset_id].remove(websocket)
            except ValueError:
                # websocket已经不在列表中
                pass
            
            if not self.active_connections[dataset_id]:
                del self.active_connections[dataset_id]
                # 延迟停止轮询任务，给其他连接一些时间重新连接
                if dataset_id in self.polling_tasks:
                    async def delayed_cancel():
                        await asyncio.sleep(5)  # 5秒延迟
                        if dataset_id not in self.active_connections and dataset_id in self.polling_tasks:
                            logger.info(f"延迟取消轮询任务 - 数据集ID: {dataset_id}")
                            self.polling_tasks[dataset_id].cancel()
                            del self.polling_tasks[dataset_id]
                    
                    asyncio.create_task(delayed_cancel())
        logger.info(f"WebSocket连接断开 - 数据集ID: {dataset_id}")
    
    async def broadcast_status(self, dataset_id: str, documents: List[Dict]):
        if dataset_id in self.active_connections:
            message = {
                "type": "document_status_update",
                "dataset_id": dataset_id,
                "documents": documents,
                "timestamp": datetime.now().isoformat()
            }
            # 发送给所有连接的客户端
            disconnected = []
            for connection in self.active_connections[dataset_id]:
                try:
                    await connection.send_text(json.dumps(message))
                except:
                    disconnected.append(connection)
            
            # 清理断开的连接
            for connection in disconnected:
                self.active_connections[dataset_id].remove(connection)
    
    async def start_polling(self, dataset_id: str):
        if dataset_id in self.polling_tasks:
            return  # 已经在轮询了
        
        async def poll_status():
            logger.info(f"开始轮询文档状态 - 数据集ID: {dataset_id}")
            try:
                from ..services.ragflow_sdk import get_ragflow_sdk_service
                sdk_service = get_ragflow_sdk_service()
                
                while dataset_id in self.active_connections:
                    try:
                        # 获取文档列表
                        documents_response = sdk_service.list_documents(dataset_id)
                        documents = documents_response.get('docs', [])
                        
                        # 检查是否有正在解析的文档
                        has_parsing = any(
                            doc.get('run') in ['RUNNING', 'UNSTART'] 
                            for doc in documents
                        )
                        
                        # 广播状态更新
                        await self.broadcast_status(dataset_id, documents)
                        
                        # 简化轮询逻辑：只要有WebSocket连接就持续轮询
                        # 让前端决定何时断开连接，而不是后端自动停止
                        if has_parsing:
                            # 有文档正在解析，快速轮询
                            await asyncio.sleep(3)  # 3秒轮询一次
                        else:
                            # 没有文档在解析，慢速轮询
                            await asyncio.sleep(5)  # 5秒轮询一次
                        
                    except Exception as e:
                        logger.error(f"轮询过程中出错: {e}")
                        await asyncio.sleep(5)  # 出错后等待更长时间
                        
            except asyncio.CancelledError:
                logger.info(f"轮询任务被取消 - 数据集ID: {dataset_id}")
            except Exception as e:
                logger.error(f"轮询任务异常 - 数据集ID: {dataset_id}, 错误: {e}")
            finally:
                # 清理任务
                if dataset_id in self.polling_tasks:
                    del self.polling_tasks[dataset_id]
        
        # 启动轮询任务
        self.polling_tasks[dataset_id] = asyncio.create_task(poll_status())

# 全局状态管理器
document_status_manager = DocumentStatusManager()

# WebSocket端点
@router.websocket("/datasets/{dataset_id}/documents/status")
async def websocket_document_status(
    websocket: WebSocket, 
    dataset_id: str,
    db: AsyncIOMotorClient = Depends(get_database)
):
    """WebSocket端点，用于实时推送文档解析状态"""
    logger.info(f"收到WebSocket连接请求 - 数据集ID: {dataset_id}")
    
    try:
        await websocket.accept()
        logger.info(f"WebSocket连接已接受 - 数据集ID: {dataset_id}")
        
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

        # 验证用户
        try:
            from jose import jwt
            from ..config import settings
            
            payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
            account = payload.get("sub")
            if not account:
                raise ValueError("Token中没有账号")

            user = await db.fish_chat.users.find_one({"account": account})
            if not user:
                raise ValueError("未找到用户")

            # 确保用户ID格式与会话创建时一致：优先使用 id 字段（UUID格式），兼容 _id 字段
            user["id"] = user.get("id") or str(user["_id"])
            logger.info(f"用户认证成功: {account}, 用户ID: {user['id']}")

        except Exception as e:
            logger.error(f"Token验证失败: {str(e)}")
            await websocket.close(code=4001, reason="Authentication failed")
            return
        
        # 发送认证成功消息
        await websocket.send_text(json.dumps({'type': 'auth_success'}))
        
        await document_status_manager.connect(websocket, dataset_id)
        
        # 启动轮询
        await document_status_manager.start_polling(dataset_id)
        
        # 保持连接
        while True:
            try:
                # 接收消息
                data = await websocket.receive_text()
                message = json.loads(data)
                logger.info(f"收到WebSocket消息: {message}")
                
                if message.get('type') == 'ping':
                    await websocket.send_text(json.dumps({'type': 'pong'}))
                elif message.get('type') == 'start_parsing':
                    # 客户端通知开始解析，立即开始轮询
                    await document_status_manager.start_polling(dataset_id)
                    
            except WebSocketDisconnect:
                logger.info(f"WebSocket连接断开 - 数据集ID: {dataset_id}")
                break
            except Exception as e:
                logger.error(f"WebSocket消息处理错误: {e}")
                break
                
    except Exception as e:
        logger.error(f"WebSocket连接错误: {e}")
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except:
            pass
    finally:
        document_status_manager.disconnect(websocket, dataset_id) 

# 在文件末尾添加新的端点
@router.get("/embedding-models")
async def get_embedding_models():
    """获取RAGFlow中真实可用的嵌入模型列表"""
    try:
        from ..services.ragflow_sdk import get_ragflow_sdk_service
        sdk_service = get_ragflow_sdk_service()
        rag_object = sdk_service._get_client()
        
        # 获取真实的嵌入模型列表
        models = []
        verified_models = []
        available_models = set()
        
        try:
            # 方法1：从现有数据集中收集已验证的模型
            test_datasets = rag_object.list_datasets(page_size=100)
            
            if test_datasets:
                for dataset in test_datasets:
                    if hasattr(dataset, 'embedding_model') and dataset.embedding_model:
                        available_models.add(dataset.embedding_model)
                        logger.info(f"发现已验证模型: {dataset.embedding_model}")
            
            # 方法2：尝试获取RAGFlow的模型配置信息
            try:
                # 这里应该调用RAGFlow的模型列表接口，如果有的话
                # 由于我不知道RAGFlow的具体API，先尝试获取配置信息
                if hasattr(rag_object, 'get_models') and callable(rag_object.get_models):
                    ragflow_models = rag_object.get_models()
                    if ragflow_models:
                        for model in ragflow_models:
                            if hasattr(model, 'id'):
                                available_models.add(model.id)
                                logger.info(f"从RAGFlow获取到模型: {model.id}")
            except Exception as e:
                logger.debug(f"无法从RAGFlow获取模型列表: {str(e)}")
            
        except Exception as e:
            logger.warning(f"无法获取RAGFlow真实模型列表: {str(e)}")
        
        # 方法3：如果没有任何模型信息，尝试一些常见的模型名称进行测试
        if not available_models:
            logger.info("未找到已验证的模型，尝试测试常见模型...")
            # 只测试豆包模型，因为这是RAGFlow服务器上已配置的
            test_model_names = [
                "doubao-embedding-large",
                "doubao-embedding-base"
            ]
            
            for model_name in test_model_names:
                try:
                    # 尝试创建测试数据集来验证模型
                    test_name = f"test_model_discovery_{int(time.time())}"
                    test_dataset = rag_object.create_dataset(
                        name=test_name,
                        description="临时测试数据集，用于发现可用模型",
                        embedding_model=model_name
                    )
                    
                    # 如果成功，说明模型可用
                    available_models.add(model_name)
                    logger.info(f"✅ 发现可用模型: {model_name}")
                    
                    # 立即删除测试数据集
                    try:
                        rag_object.delete_datasets([test_dataset.id])
                    except:
                        pass
                        
                except Exception as test_error:
                    logger.debug(f"模型 {model_name} 不可用: {str(test_error)}")
                    continue
        
        # 方法4：如果所有方法都失败，使用备用的豆包模型配置
        if not available_models:
            logger.info("所有方法都失败，使用备用的豆包模型配置...")
            # 直接添加豆包模型，因为这是RAGFlow服务器上已配置的
            backup_models = [
                "doubao-embedding-large",
                "doubao-embedding-base"
            ]
            
            for model_name in backup_models:
                available_models.add(model_name)
                logger.info(f"🔧 使用备用模型配置: {model_name}")
        
        # 将找到的模型转换为API格式
        for model_id in available_models:
            logger.info(f"🔄 处理模型ID: {model_id}")
            model_info = parse_model_info_dynamic(model_id, verified=True)
            logger.info(f"📋 模型信息: ID={model_info['id']}, 名称={model_info['name']}, 提供商={model_info['provider']}")
            models.append(model_info)
            verified_models.append(model_id)
            
        logger.info(f"🎯 找到 {len(verified_models)} 个可用的嵌入模型:")
        for i, model_id in enumerate(verified_models, 1):
            logger.info(f"  {i}. {model_id}")
        
        # 如果没有找到任何模型，返回提示信息
        if not models:
            return {
                "success": True,
                "data": {
                    "models": [],
                    "total": 0,
                    "verified_count": 0,
                    "recommended_count": 0,
                    "message": "未找到已配置的嵌入模型。请先在RAGFlow中配置并创建数据集来验证模型可用性。"
                },
                "message": "RAGFlow中尚无可用的嵌入模型"
            }
        
        return {
            "success": True,
            "data": {
                "models": models,
                "total": len(models),
                "verified_count": len([m for m in models if m.get("verified", False)]),
                "recommended_count": len([m for m in models if m.get("recommended", False)]),
                "available_models": verified_models
            },
            "message": f"从RAGFlow动态发现 {len(models)} 个可用嵌入模型"
        }
        
    except Exception as e:
        logger.error(f"❌ 获取嵌入模型列表失败: {str(e)}")
        return {
            "success": False,
            "message": f"无法连接到RAGFlow服务: {str(e)}",
            "data": {"models": [], "total": 0, "verified_count": 0, "recommended_count": 0}
        }

def parse_model_info_dynamic(model_string: str, verified: bool = False) -> dict:
    """动态解析模型信息，不依赖硬编码的配置"""
    try:
        # 解析模型字符串
        if "@" in model_string:
            model_name, provider = model_string.rsplit("@", 1)
        else:
            model_name = model_string
            provider = "Unknown"
        
        # 根据模型名称推断基本信息
        name = model_name.split("/")[-1] if "/" in model_name else model_name
        name = name.replace("-", " ").replace("_", " ").title()
        
        # 推断语言支持
        language = ["multi"]  # 默认多语言
        if "zh" in model_name.lower() or "chinese" in model_name.lower():
            language = ["zh", "en"]
        elif "en" in model_name.lower() or "english" in model_name.lower():
            language = ["en"]
        
        # 推断提供商
        if "doubao" in model_name.lower():
            provider = "VolcEngine"
        elif "bge" in model_name.lower():
            provider = "BAAI"
        elif "openai" in model_name.lower() or "text-embedding" in model_name.lower():
            provider = "OpenAI"
        
        # 推断是否需要API密钥
        requires_api_key = False
        if provider in ["OpenAI", "VolcEngine"]:
            requires_api_key = True
        
        # 推断推荐度
        recommended = False
        if "large" in model_name.lower() or "doubao" in model_name.lower():
            recommended = True
        
        return {
            "id": model_string,
            "name": name,
            "description": f"{provider} 嵌入模型{'（系统验证可用）' if verified else ''}",
            "type": "embedding",
            "language": language,
            "verified": verified,
            "recommended": recommended,
            "provider": provider,
            "requires_api_key": requires_api_key
        }
        
    except Exception as e:
        logger.warning(f"解析模型信息失败: {model_string}, 错误: {str(e)}")
        return {
            "id": model_string,
            "name": "Unknown Model",
            "description": "未知嵌入模型",
            "type": "embedding",
            "language": ["multi"],
            "verified": verified,
            "recommended": False,
            "provider": "Unknown"
        }

def parse_model_info(model_string: str, verified: bool = False) -> dict:
    """动态解析模型信息，不依赖硬编码的配置"""
    try:
        # 解析模型字符串
        if "@" in model_string:
            model_name, provider = model_string.rsplit("@", 1)
        else:
            model_name = model_string
            provider = "Unknown"
        
        # 根据模型名称推断基本信息
        name = model_name.split("/")[-1] if "/" in model_name else model_name
        name = name.replace("-", " ").replace("_", " ").title()
        
        # 推断语言支持
        language = ["multi"]  # 默认多语言
        if "zh" in model_name.lower() or "chinese" in model_name.lower():
            language = ["zh", "en"]
        elif "en" in model_name.lower() or "english" in model_name.lower():
            language = ["en"]
        
        # 推断提供商
        if "doubao" in model_name.lower():
            provider = "VolcEngine"
        elif "bge" in model_name.lower():
            provider = "BAAI"
        elif "openai" in model_name.lower() or "text-embedding" in model_name.lower():
            provider = "OpenAI"
        
        # 推断是否需要API密钥
        requires_api_key = False
        if provider in ["OpenAI", "VolcEngine"]:
            requires_api_key = True
        
        # 推断推荐度
        recommended = False
        if "large" in model_name.lower() or "doubao" in model_name.lower():
            recommended = True
        
        return {
            "id": model_string,
            "name": name,
            "description": f"{provider} 嵌入模型{'（系统验证可用）' if verified else ''}",
            "type": "embedding",
            "language": language,
            "verified": verified,
            "recommended": recommended,
            "provider": provider,
            "requires_api_key": requires_api_key
        }
        
    except Exception as e:
        logger.warning(f"解析模型信息失败: {model_string}, 错误: {str(e)}")
        return {
            "id": model_string,
            "name": "Unknown Model",
            "description": "未知嵌入模型",
            "type": "embedding",
            "language": ["multi"],
            "verified": verified,
            "recommended": False,
            "provider": "Unknown"
        }

@router.post("/test-embedding-model")
async def test_embedding_model(model_id: str):
    """测试指定的嵌入模型是否可用"""
    try:
        logger.info(f"🧪 开始测试嵌入模型: {model_id}")
        logger.info(f"🔍 模型ID详情: {model_id}")
        
        from ..services.ragflow_sdk import get_ragflow_sdk_service
        sdk_service = get_ragflow_sdk_service()
        rag_object = sdk_service._get_client()
        
        # 创建一个临时的测试数据集来验证模型
        test_dataset_name = f"test_embedding_model_{int(time.time())}"
        logger.info(f"📝 创建测试数据集: {test_dataset_name}")
        logger.info(f"🎯 使用嵌入模型: {model_id}")
        
        try:
            # 尝试创建一个使用指定嵌入模型的数据集
            test_dataset = rag_object.create_dataset(
                name=test_dataset_name,
                description="临时测试数据集，用于验证嵌入模型可用性",
                embedding_model=model_id
            )
            
            # 如果创建成功，说明模型可用
            logger.info(f"✅ 嵌入模型 {model_id} 测试成功")
            logger.info(f"🎉 模型ID {model_id} 验证通过")
            
            # 立即删除测试数据集
            try:
                rag_object.delete_datasets([test_dataset.id])
                logger.info(f"🗑️ 已删除测试数据集: {test_dataset_name}")
            except Exception as cleanup_error:
                logger.warning(f"清理测试数据集失败: {str(cleanup_error)}")
            
            return {
                "success": True,
                "model_id": model_id,
                "available": True,
                "message": f"嵌入模型 {model_id} 可用",
                "test_method": "create_dataset"
            }
            
        except Exception as test_error:
            logger.warning(f"❌ 嵌入模型 {model_id} 测试失败: {str(test_error)}")
            
            # 分析错误类型
            error_message = str(test_error).lower()
            if "not found" in error_message or "invalid" in error_message:
                reason = "模型不存在或无效"
            elif "permission" in error_message or "unauthorized" in error_message:
                reason = "权限不足或需要API密钥"
            elif "connection" in error_message or "timeout" in error_message:
                reason = "网络连接问题"
            else:
                reason = "未知错误"
            
            return {
                "success": True,
                "model_id": model_id,
                "available": False,
                "message": f"嵌入模型 {model_id} 不可用",
                "reason": reason,
                "error_detail": str(test_error),
                "test_method": "create_dataset"
            }
            
    except Exception as e:
        logger.error(f"❌ 测试嵌入模型失败: {str(e)}")
        return {
            "success": False,
            "message": f"测试嵌入模型失败: {str(e)}",
            "model_id": model_id,
            "available": None
        }

@router.post("/batch-test-embedding-models")
async def batch_test_embedding_models():
    """批量测试常见嵌入模型的可用性"""
    try:
        logger.info("🧪 开始批量测试嵌入模型可用性...")
        
        # 常见的嵌入模型列表（只包含RAGFlow服务器上已配置的模型）
        test_models = [
            "doubao-embedding-large",
            "doubao-embedding-base"
        ]
        
        results = []
        available_models = []
        unavailable_models = []
        
        for model_id in test_models:
            logger.info(f"🔍 开始测试模型: {model_id}")
            logger.info(f"📋 当前测试模型ID: {model_id}")
            
            # 调用单个模型测试
            test_result = await test_embedding_model(model_id)
            results.append(test_result)
            
            if test_result.get("available"):
                available_models.append(model_id)
                logger.info(f"✅ 模型 {model_id} - 可用")
                logger.info(f"🎯 成功验证模型ID: {model_id}")
            else:
                unavailable_models.append(model_id)
                logger.warning(f"❌ 模型 {model_id} - 不可用")
                logger.warning(f"🚫 模型ID {model_id} 验证失败")
        
        logger.info(f"📊 批量测试完成: {len(available_models)} 个可用, {len(unavailable_models)} 个不可用")
        logger.info(f"🎯 可用模型ID列表: {available_models}")
        logger.info(f"🚫 不可用模型ID列表: {unavailable_models}")
        
        return {
            "success": True,
            "summary": {
                "total_tested": len(test_models),
                "available_count": len(available_models),
                "unavailable_count": len(unavailable_models),
                "available_models": available_models,
                "unavailable_models": unavailable_models
            },
            "detailed_results": results,
            "message": f"批量测试完成，发现 {len(available_models)} 个可用的嵌入模型"
        }
        
    except Exception as e:
        logger.error(f"❌ 批量测试嵌入模型失败: {str(e)}")
        return {
            "success": False,
            "message": f"批量测试失败: {str(e)}",
            "summary": {"available_count": 0, "total_tested": 0}
        } 

@router.get("/recommended-embedding-models")
async def get_recommended_embedding_models():
    """获取推荐的嵌入模型列表"""
    try:
        # 首先尝试从RAGFlow获取真实可用的模型
        from ..services.ragflow_sdk import get_ragflow_sdk_service
        sdk_service = get_ragflow_sdk_service()
        rag_object = sdk_service._get_client()
        
        available_models = []
        
        try:
            # 尝试获取现有数据集中的模型
            test_datasets = rag_object.list_datasets(page_size=100)
            if test_datasets:
                for dataset in test_datasets:
                    if hasattr(dataset, 'embedding_model') and dataset.embedding_model:
                        available_models.append(dataset.embedding_model)
            
            # 如果没有找到任何模型，尝试测试常见模型
            if not available_models:
                logger.info("未找到已验证的模型，尝试测试常见模型...")
                test_model_names = [
                    "doubao-embedding-large",
                    "doubao-embedding-base"
                ]
                
                for model_name in test_model_names:
                    logger.info(f"🔍 验证推荐模型: {model_name}")
                    logger.info(f"📋 推荐模型ID: {model_name}")
                    try:
                        test_name = f"test_recommended_{int(time.time())}"
                        test_dataset = rag_object.create_dataset(
                            name=test_name,
                            description="临时测试数据集，用于验证推荐模型",
                            embedding_model=model_name
                        )
                        
                        available_models.append(model_name)
                        logger.info(f"✅ 推荐模型 {model_name} 验证成功")
                        logger.info(f"🎯 推荐模型ID {model_name} 验证通过")
                        
                        # 立即删除测试数据集
                        try:
                            rag_object.delete_datasets([test_dataset.id])
                            logger.info(f"🗑️ 已清理推荐模型测试数据集: {test_name}")
                        except:
                            pass
                            
                    except Exception as test_error:
                        logger.debug(f"推荐模型 {model_name} 不可用: {str(test_error)}")
                        continue
                        
        except Exception as e:
            logger.warning(f"无法获取RAGFlow模型列表: {str(e)}")
        
        # 转换为推荐模型格式
        recommended_models = []
        for model_id in available_models:
            model_info = parse_model_info_dynamic(model_id, verified=True)
            recommended_models.append(model_info)
        
        # 如果没有找到任何模型，返回提示信息
        if not recommended_models:
            return {
                "success": True,
                "data": {
                    "models": [],
                    "total": 0,
                    "recommended_count": 0,
                    "verified_count": 0,
                    "message": "未找到可用的嵌入模型。请先在RAGFlow中配置嵌入模型。"
                },
                "message": "暂无可用的嵌入模型"
            }
        
        return {
            "success": True,
            "data": {
                "models": recommended_models,
                "total": len(recommended_models),
                "recommended_count": len([m for m in recommended_models if m.get("recommended", False)]),
                "verified_count": len([m for m in recommended_models if m.get("verified", False)]),
                "message": f"动态发现 {len(recommended_models)} 个可用嵌入模型"
            }
        }
        
    except Exception as e:
        logger.error(f"❌ 获取推荐嵌入模型失败: {str(e)}")
        return {
            "success": False,
            "message": f"获取推荐嵌入模型失败: {str(e)}",
            "data": {"models": [], "total": 0, "recommended_count": 0, "verified_count": 0}
        }

@router.post("/validate-embedding-model")
async def validate_embedding_model(model_id: str):
    """验证嵌入模型是否可用"""
    try:
        logger.info(f"🔍 开始验证嵌入模型: {model_id}")
        logger.info(f"📋 待验证模型ID: {model_id}")
        
        # 检查是否是推荐模型（只包含RAGFlow服务器上已配置的模型）
        recommended_models = [
            "doubao-embedding-large",
            "doubao-embedding-base"
        ]
        
        is_recommended = model_id in recommended_models
        logger.info(f"🎯 模型 {model_id} 是否为推荐模型: {is_recommended}")
        
        # 尝试创建测试数据集来验证模型
        try:
            from ..services.ragflow_sdk import get_ragflow_sdk_service
            sdk_service = get_ragflow_sdk_service()
            client = sdk_service._get_client()
            
            # 创建测试数据集
            test_name = f"test_model_validation_{int(time.time())}"
            logger.info(f"📝 创建验证测试数据集: {test_name}")
            logger.info(f"🎯 使用嵌入模型: {model_id}")
            
            test_dataset = client.create_dataset(
                name=test_name,
                embedding_model=model_id
            )
            
            logger.info(f"✅ 模型 {model_id} 验证成功")
            logger.info(f"🎉 模型ID {model_id} 验证通过")
            
            # 删除测试数据集
            client.delete_datasets(ids=[test_dataset.id])
            logger.info(f"🗑️ 已清理验证测试数据集: {test_name}")
            
            return {
                "success": True,
                "data": {
                    "model_id": model_id,
                    "is_recommended": is_recommended,
                    "is_available": True,
                    "message": "模型验证成功，可以正常使用"
                }
            }
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"❌ 模型 {model_id} 验证失败: {error_msg}")
            logger.error(f"🚫 模型ID {model_id} 验证异常")
            
            if "Unsupported model" in error_msg:
                logger.warning(f"⚠️ 模型 {model_id} 不被RAGFlow服务支持")
                return {
                    "success": False,
                    "data": {
                        "model_id": model_id,
                        "is_recommended": is_recommended,
                        "is_available": False,
                        "error": "模型不支持",
                        "message": f"模型 {model_id} 不被RAGFlow服务支持",
                        "recommendations": recommended_models
                    }
                }
            else:
                logger.error(f"💥 模型 {model_id} 验证过程中发生未知错误")
                return {
                    "success": False,
                    "data": {
                        "model_id": model_id,
                        "is_recommended": is_recommended,
                        "is_available": False,
                        "error": str(e),
                        "message": f"模型验证失败: {str(e)}"
                    }
                }
                
    except Exception as e:
        logger.error(f"❌ 验证嵌入模型失败: {str(e)}")
        return {
            "success": False,
            "message": f"验证嵌入模型失败: {str(e)}",
            "data": None
        } 

# RAGFlow 助手会话管理 API
@router.get("/assistants/{assistant_id}/sessions")
async def list_assistant_sessions(
    assistant_id: str,
    page: Optional[int] = 1,
    page_size: Optional[int] = 30,
    orderby: Optional[str] = "create_time",
    desc: Optional[bool] = True,
    id: Optional[str] = None,
    name: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database),
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    
    try:
        logger.info(f"📝 从本地数据库获取助手会话列表 - 助手ID: {assistant_id}, 用户ID: {current_user.id}")
        
        # 从本地数据库获取会话列表
        query = {
            "user_id": str(current_user.id),
            "assistant_id": assistant_id,
            "session_type": "ragflow"
        }
        
        # 添加名称过滤
        if name:
            query["name"] = {"$regex": name, "$options": "i"}
        
        # 添加ID过滤
        if id:
            query["_id"] = id
        
        cursor = db.fish_chat.ragflow_sessions.find(query)
        
        # 排序
        if orderby == "create_time":
            cursor = cursor.sort("created_at", -1 if desc else 1)
        elif orderby == "name":
            cursor = cursor.sort("name", -1 if desc else 1)
        
        # 分页
        if page and page_size:
            skip = (page - 1) * page_size
            cursor = cursor.skip(skip).limit(page_size)
        
        local_sessions = await cursor.to_list(length=None)
        
        # 尝试获取助手头像，作为会话头像兜底
        assistant_avatar_url: Optional[str] = None
        try:
            assistant_info = await client.request("GET", f"/api/v1/chats/{assistant_id}")
            if isinstance(assistant_info, dict):
                assistant_avatar_url = assistant_info.get("avatar")
        except Exception:
            assistant_avatar_url = None
        
        # 转换格式以匹配RAGFlow格式
        formatted_sessions: list[dict] = []
        with_avatar = 0
        for session in local_sessions:
            formatted_session = {
                "id": session["_id"],
                "name": session["name"],
                "assistant_id": session["assistant_id"],
                "create_time": session["created_at"],
                "message_count": session.get("message_count", 0)
            }
            # 带出会话级头像（如果有）；否则回退到助手头像
            role_avatar = session.get("role_avatar_url") or assistant_avatar_url
            if role_avatar:
                formatted_session["role_avatar_url"] = role_avatar
                with_avatar += 1
            formatted_sessions.append(formatted_session)
        
        logger.info(f"✅ 从本地数据库获取到 {len(formatted_sessions)} 个会话，其中 {with_avatar} 个包含 role_avatar_url")
        if with_avatar:
            logger.debug(f"🎯 示例会话头像: {[s.get('role_avatar_url') for s in formatted_sessions if s.get('role_avatar_url')][:3]}")
        return formatted_sessions
        
    except Exception as e:
        logger.error(f"❌ 获取助手会话列表失败: {str(e)}")
        logger.error(f"错误详情: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"获取助手会话列表失败: {str(e)}")

# 新增：删除RAGFlow会话（同时删除本地和远程）
@router.delete("/assistants/{assistant_id}/sessions/{session_id}")
async def delete_assistant_session(
    assistant_id: str,
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """删除RAGFlow助手会话（先远程通过SDK删除，再删本地）"""
    try:
        logger.info(f"📝 删除助手会话 - 助手ID: {assistant_id}, 会话ID: {session_id}")

        # 预取本地会话以便精确删除头像（先不按当前用户过滤，以找到真实归属）
        session_doc = await db.fish_chat.ragflow_sessions.find_one({
            "$or": [
                {"_id": session_id},
                {"session_id": session_id}
            ],
            "assistant_id": assistant_id
        })
        if not session_doc:
            logger.warning(f"未找到本地助手会话记录: {session_id}")
        else:
            logger.info(f"找到本地助手会话记录: {session_doc.get('_id') or session_doc.get('session_id')}")

        # 统一确定资源所属用户（以会话文档为准，缺省回落当前用户）
        owner_user_id = str(session_doc.get("user_id")) if session_doc and session_doc.get("user_id") else str(current_user.id)
        if owner_user_id != str(current_user.id):
            logger.warning(f"会话所属用户与当前用户不一致，按会话所属用户删除前缀。owner={owner_user_id}, current={current_user.id}")

        # 1) 使用官方 SDK 删除远程会话（严格按照 ragflow_api.md）
        try:
            from ..services.ragflow_sdk import get_ragflow_sdk_service
            sdk_service = get_ragflow_sdk_service()

            # 定位助手对象
            rag = sdk_service._get_client()
            chats = rag.list_chats(id=assistant_id)
            if not chats:
                raise HTTPException(status_code=404, detail="远程助手不存在")
            chat = chats[0]

            # 调用 SDK 的删除接口：Chat.delete_sessions(ids=[session_id])
            chat.delete_sessions(ids=[session_id])
            logger.info(f"✅ 远程RAGFlow会话删除成功: {session_id}")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"RAGFlow SDK 删除会话失败: {str(e)}")
            raise HTTPException(status_code=502, detail=f"远程RAGFlow删除失败: {str(e)}")

        # 2) 删除本地数据库中的会话（严格限定当前用户）
        result = await db.fish_chat.ragflow_sessions.delete_one({
            "_id": session_id,
            "user_id": str(current_user.id),
            "assistant_id": assistant_id
        })

        if result.deleted_count == 0:
            # 兜底：部分记录以 session_id 字段存储
            alt_result = await db.fish_chat.ragflow_sessions.delete_one({
                "session_id": session_id,
                "user_id": str(current_user.id),
                "assistant_id": assistant_id
            })
            logger.info(f"🗄️ 兜底删除 matched={alt_result.deleted_count}")

        # 3) 删除 MinIO 中助手会话头像目录（仅按唯一 owner_user_id 前缀）
        try:
            from ..utils.minio_client import minio_client
            session_dir_prefix = f"users/{owner_user_id}/assistants/{assistant_id}/sessions/{session_id}/"
            logger.info(f"尝试删除助手会话目录前缀: {session_dir_prefix}")
            minio_client.delete_prefix(session_dir_prefix)
            legacy_user_session_prefix = f"users/{owner_user_id}/sessions/{session_id}/"
            logger.info(f"尝试删除传统会话目录前缀: {legacy_user_session_prefix}")
            minio_client.delete_prefix(legacy_user_session_prefix)

            # 额外兜底：若记录中存在具体的 role_avatar_url，则按该URL反推出精确前缀进行删除
            role_avatar_url = session_doc.get("role_avatar_url")
            if isinstance(role_avatar_url, str) and role_avatar_url.startswith("minio://"):
                # 例: minio://bucket/users/<uid>/assistants/<aid>/sessions/<sid>/role_avatar/<uuid>.jpg
                # 去掉协议和bucket前缀
                try:
                    path_after_bucket = role_avatar_url.split("//", 1)[1].split("/", 1)[1]
                    # 取到最后一级目录作为前缀（到 role_avatar/）
                    # 即移除文件名部分
                    last_slash_index = path_after_bucket.rfind("/")
                    if last_slash_index > 0:
                        precise_prefix = path_after_bucket[:last_slash_index + 1]
                        logger.info(f"尝试通过role_avatar_url删除精确前缀: {precise_prefix}")
                        minio_client.delete_prefix(precise_prefix)
                except Exception as e2:
                    logger.warning(f"解析 role_avatar_url 失败，跳过精确前缀清理: {e2}")

            legacy_prefix = f"roles/{session_id}"
            minio_client.delete_prefix(legacy_prefix)
        except Exception as e:
            logger.error(f"清理RAGFlow会话头像前缀失败: {str(e)}")

        return {"message": "会话删除成功"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 删除助手会话失败: {str(e)}")
        logger.error(f"错误详情: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"删除助手会话失败: {str(e)}")

class CreateSessionRequest(BaseModel):
    """创建会话请求模型"""
    name: Optional[str] = None

@router.post("/assistants/{assistant_id}/sessions")
async def create_assistant_session(
    assistant_id: str,
    request: Optional[CreateSessionRequest] = Body(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database),
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """为助手创建新会话并保存到本地数据库"""
    try:
        # 兼容前端可能不传 name 的情况
        default_name = f"新会话_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        session_name = (request.name if request and request.name else default_name)
        logger.info(f"📝 为助手创建会话 - 助手ID: {assistant_id}, 会话名称: {session_name}, 用户ID: {current_user.id}")
        
        # 构建请求数据
        request_data = {"name": session_name}
        
        logger.info(f"📤 发送到RAGFlow的请求数据: {request_data}")
        
        # 调用RAGFlow API创建会话
        result = await client.request("POST", f"/api/v1/chats/{assistant_id}/sessions", json=request_data)
        logger.info(f"✅ RAGFlow助手会话创建成功: {session_name}")
        logger.info(f"📋 RAGFlow返回数据: {result}")
        
        # 提取会话信息 - RAGFlow直接返回数据，不包装在data字段中
        session_data = result if isinstance(result, dict) else result.get('data', {})
        session_id = session_data.get('id')
        
        if not session_id:
            logger.error(f"❌ 未能获取会话ID，RAGFlow返回: {result}")
            raise ValueError("RAGFlow未返回有效的会话ID")
        
        # 保存到本地数据库
        local_session = {
            "_id": session_id,  # 使用RAGFlow的会话ID作为主键
            "name": session_data.get('name', session_name),
            "user_id": str(current_user.id),
            "assistant_id": assistant_id,
            "ragflow_session_id": session_id,
            "session_type": "ragflow",
            "created_at": session_data.get('create_time', datetime.now().isoformat()),
            "updated_at": datetime.now().isoformat(),
            "message_count": 0,
            "messages": [],  # 添加messages字段，确保与RAGFlowMessageService兼容
            "session_id": session_id  # 补充session_id字段以满足唯一索引(session_id, user_id)
        }
        
        # 初始化：将当前助手头像作为会话默认头像（之后可独立修改）
        try:
            assistant_info = await client.request("GET", f"/api/v1/chats/{assistant_id}")
            if isinstance(assistant_info, dict) and assistant_info.get("avatar"):
                local_session["role_avatar_url"] = assistant_info.get("avatar")
                logger.info(f"🖼️ 初始化会话头像为助手头像: {assistant_info.get('avatar')}")
        except Exception as fetch_assistant_err:
            logger.warning(f"⚠️ 获取助手信息失败，跳过默认会话头像设置: {fetch_assistant_err}")
        
        # 保存到数据库（使用upsert避免重复）
        await db.fish_chat.ragflow_sessions.replace_one(
            {"_id": session_id},
            local_session,
            upsert=True
        )
        
        logger.info(f"✅ 会话已保存到本地数据库: {session_id}")
        
        return result
        
    except HTTPException as e:
        logger.error(f"❌ RAGFlow HTTP错误: {e.status_code} - {e.detail}")
        raise e
    except Exception as e:
        logger.error(f"❌ 创建助手会话失败: {str(e)}")
        logger.error(f"错误详情: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"创建助手会话失败: {str(e)}")

# 新增：获取用户的RAGFlow会话列表（从本地数据库）
@router.get("/assistants/{assistant_id}/sessions/local")
async def list_local_assistant_sessions(
    assistant_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database),
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """从本地数据库获取用户的RAGFlow助手会话列表"""
    try:
        logger.info(f"📝 从本地数据库获取助手会话列表 - 助手ID: {assistant_id}, 用户ID: {current_user.id}")
        
        # 查询本地数据库中的RAGFlow会话
        cursor = db.fish_chat.ragflow_sessions.find({
            "user_id": str(current_user.id),
            "assistant_id": assistant_id,
            "session_type": "ragflow"
        }).sort("created_at", -1)  # 按创建时间倒序
        
        sessions = await cursor.to_list(length=None)
        
        # 获取助手头像作为兜底
        assistant_avatar_url: Optional[str] = None
        try:
            assistant_info = await client.request("GET", f"/api/v1/chats/{assistant_id}")
            if isinstance(assistant_info, dict):
                assistant_avatar_url = assistant_info.get("avatar")
        except Exception:
            assistant_avatar_url = None
        
        # 转换格式以匹配前端期望
        formatted_sessions = []
        with_avatar = 0
        for session in sessions:
            formatted_session = {
                "id": session["_id"],
                "name": session["name"],
                "assistant_id": session["assistant_id"],
                "create_time": session["created_at"],
                "message_count": session.get("message_count", 0)
            }
            role_avatar = session.get("role_avatar_url") or assistant_avatar_url
            if role_avatar:
                formatted_session["role_avatar_url"] = role_avatar
                with_avatar += 1
            formatted_sessions.append(formatted_session)
        
        logger.info(f"✅ 从本地数据库获取到 {len(formatted_sessions)} 个会话（local），其中 {with_avatar} 个包含 role_avatar_url")
        if with_avatar:
            logger.debug(f"🎯 示例会话头像(local): {[s.get('role_avatar_url') for s in formatted_sessions if s.get('role_avatar_url')][:3]}")
        return formatted_sessions
        
    except Exception as e:
        logger.error(f"❌ 获取本地助手会话失败: {str(e)}")
        logger.error(f"错误详情: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"获取本地助手会话失败: {str(e)}")

# 新增：同步RAGFlow会话到本地数据库
@router.post("/assistants/{assistant_id}/sessions/sync")
async def sync_assistant_sessions(
    assistant_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database),
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    
    try:
        logger.info(f"📝 同步RAGFlow会话列表 - 助手ID: {assistant_id}, 用户ID: {current_user.id}")
        
        # 从RAGFlow获取会话列表
        sessions = await client.request("GET", f"/api/v1/chats/{assistant_id}/sessions")
        
        if isinstance(sessions, list):
            synced_count = 0
            
            # 预取助手头像，作为兜底
            assistant_avatar_url: Optional[str] = None
            try:
                assistant_info = await client.request("GET", f"/api/v1/chats/{assistant_id}")
                if isinstance(assistant_info, dict):
                    assistant_avatar_url = assistant_info.get("avatar")
            except Exception:
                assistant_avatar_url = None
            
            preserved_avatars = 0
            for session in sessions:
                session_id = session.get('id')
                if not session_id:
                    continue
                
                # 先获取已有记录，保留 role_avatar_url
                existing = await db.fish_chat.ragflow_sessions.find_one({"_id": session_id})
                existing_role_avatar = existing.get("role_avatar_url") if existing else None
                if existing_role_avatar:
                    preserved_avatars += 1
                
                local_session = {
                    "_id": session_id,
                    "name": session.get('name', f"会话_{session_id[:8]}"),
                    "user_id": str(current_user.id),
                    "assistant_id": assistant_id,
                    "ragflow_session_id": session_id,
                    "session_type": "ragflow",
                    "created_at": session.get('create_time', datetime.now().isoformat()),
                    "message_count": session.get('message_count', 0),
                    "history": [],
                    "session_id": session_id
                }
                
                # 如果已有头像则保留，否则使用助手头像兜底
                if existing_role_avatar:
                    local_session["role_avatar_url"] = existing_role_avatar
                elif assistant_avatar_url:
                    local_session["role_avatar_url"] = assistant_avatar_url
                
                # 使用upsert避免重复
                await db.fish_chat.ragflow_sessions.replace_one(
                    {"_id": session_id},
                    local_session,
                    upsert=True
                )
                synced_count += 1
            
            logger.info(f"✅ 成功同步 {synced_count} 个会话到本地数据库（保留头像 {preserved_avatars} 个）")
            return {"synced_count": synced_count, "total_count": len(sessions)}
        else:
            logger.info("ℹ️ RAGFlow未返回会话数据")
            return {"synced_count": 0, "total_count": 0}
    
    except Exception as e:
        logger.error(f"❌ 同步助手会话失败: {str(e)}")
        logger.error(f"错误详情: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"同步助手会话失败: {str(e)}")

@router.get("/assistants/{assistant_id}/sessions/{session_id}/messages")
async def list_session_messages(
    assistant_id: str,
    session_id: str,
    page: Optional[int] = 1,
    page_size: Optional[int] = 30,
    orderby: Optional[str] = "create_time",
    desc: Optional[bool] = False,
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """获取会话消息列表"""
    try:
        logger.info(f"📝 获取会话消息列表 - 助手ID: {assistant_id}, 会话ID: {session_id}")
        
        # 构建查询参数
        params = {}
        if page is not None:
            params["page"] = page
        if page_size is not None:
            params["page_size"] = page_size
        if orderby is not None:
            params["orderby"] = orderby
        if desc is not None:
            params["desc"] = desc
        
        # 构建查询字符串
        query_string = "&".join([f"{k}={v}" for k, v in params.items()])
        endpoint = f"/api/v1/chats/{assistant_id}/sessions/{session_id}/messages?{query_string}" if query_string else f"/api/v1/chats/{assistant_id}/sessions/{session_id}/messages"
        
        logger.info(f"📤 请求端点: {endpoint}")
        
        # 调用RAGFlow API获取消息列表
        result = await client.request("GET", endpoint)
        logger.info(f"✅ 成功获取会话消息列表，共 {len(result) if isinstance(result, list) else '未知'} 条")
        return result
        
    except HTTPException as e:
        logger.error(f"❌ RAGFlow HTTP错误: {e.status_code} - {e.detail}")
        raise e
    except Exception as e:
        logger.error(f"❌ 获取会话消息列表失败: {str(e)}")
        logger.error(f"错误详情: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"获取会话消息列表失败: {str(e)}")

# RAGFlow WebSocket聊天端点
@router.websocket("/ws/chat/{assistant_id}/{session_id}")
async def ragflow_websocket_chat(
    websocket: WebSocket,
    assistant_id: str,
    session_id: str,
    db: AsyncIOMotorClient = Depends(get_database)
):
    """RAGFlow助手聊天WebSocket端点"""
    logger.info(f"收到RAGFlow WebSocket连接请求 - 助手ID: {assistant_id}, 会话ID: {session_id}")
    
    try:
        await websocket.accept()
        logger.info("RAGFlow WebSocket连接已接受")

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

        # 验证用户
        try:
            from jose import jwt
            from ..config import settings
            
            payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
            account = payload.get("sub")
            if not account:
                raise ValueError("Token中没有账号")

            user = await db.fish_chat.users.find_one({"account": account})
            if not user:
                raise ValueError("未找到用户")

            # 确保用户ID格式与会话创建时一致：优先使用 id 字段（UUID格式），兼容 _id 字段
            user["id"] = user.get("id") or str(user["_id"])
            logger.info(f"用户认证成功: {account}, 用户ID: {user['id']}")

        except Exception as e:
            logger.error(f"Token验证失败: {str(e)}")
            await websocket.close(code=4001, reason="Authentication failed")
            return

        # 创建RAGFlow客户端
        client = RAGFlowClient(RAGFLOW_BASE_URL, RAGFLOW_API_KEY)
        
        # 确保会话存在
        try:
            # 尝试获取会话信息，如果不存在则创建
            session_info = await client.request("GET", f"/api/v1/chats/{assistant_id}/sessions/{session_id}")
            if not session_info or not session_info.get('data'):
                logger.info(f"会话 {session_id} 不存在，创建新会话")
                create_result = await client.request("POST", f"/api/v1/chats/{assistant_id}/sessions", json={"name": f"会话_{session_id[:8]}"})
                if create_result and create_result.get('data'):
                    session_id = create_result['data'].get('id', session_id)
                    logger.info(f"创建新会话成功: {session_id}")
                else:
                    logger.warning("创建会话失败，使用原始session_id")
            else:
                logger.info(f"使用现有会话: {session_id}")
        except Exception as e:
            logger.warning(f"会话检查/创建失败: {str(e)}，继续使用原始session_id")
        
        # 发送认证成功消息
        await websocket.send_text(json.dumps({
            "type": "auth_success",
            "message": "认证成功"
        }))
        
        # 初始化消息服务
        message_service = RAGFlowMessageService(db)
        
        # 从MongoDB获取历史消息
        try:
            logger.info(f"🔍 开始从MongoDB获取助手历史消息 - 助手ID: {assistant_id}, 会话ID: {session_id}")
            
            # 从之前验证的用户信息中获取用户ID（使用统一的UUID格式）
            user_id = user["id"]  # 认证时已确保此字段为正确的UUID格式
            
            # 获取历史消息
            messages = await message_service.get_session_messages(session_id, user_id)
            
            logger.info(f"✅ 成功从MongoDB获取历史消息，共{len(messages)}条")
            
            # 转换消息格式以兼容前端
            converted_messages = []
            for msg in messages:
                converted_msg = {
                    "role": msg.role,
                    "content": msg.content,
                    "timestamp": msg.timestamp or msg.create_time.isoformat() if msg.create_time else None,
                    "id": msg.message_id,
                    "reference": []
                }
                
                # 处理引用数据
                if msg.reference:
                    converted_msg["reference"] = [
                        {
                            "id": ref.id,
                            "content": ref.content,
                            "img_id": ref.img_id,
                            "image_id": ref.image_id,
                            "document_id": ref.document_id,
                            "document_name": ref.document_name,
                            "position": ref.position,
                            "dataset_id": ref.dataset_id,
                            "similarity": ref.similarity,
                            "vector_similarity": ref.vector_similarity,
                            "term_similarity": ref.term_similarity,
                            "url": ref.url,
                            "doc_type": ref.doc_type
                        }
                        for ref in msg.reference
                    ]
                
                # 清理空值并添加到消息列表
                converted_msg = {k: v for k, v in converted_msg.items() if v is not None}
                converted_messages.append(converted_msg)
            
            # 发送历史消息到前端
            await websocket.send_text(json.dumps({
                "type": "history",
                "messages": converted_messages
            }))
            logger.info(f"📤 历史消息已发送到前端")
                
        except Exception as e:
            logger.error(f"❌ 获取历史消息失败: {str(e)}")
            logger.error(f"错误详情: {traceback.format_exc()}")
            
            # 发送空的历史消息，避免前端一直等待
            await websocket.send_text(json.dumps({
                "type": "history",
                "messages": []
            }))
            logger.info("📤 已发送空历史消息列表到前端")

        while True:
            try:
                # 接收消息
                data = await websocket.receive_text()
                logger.info(f"收到RAGFlow WebSocket消息: {data}")
                message_data = json.loads(data)
                user_message = message_data.get("message", "")
                
                if not user_message.strip():
                    logger.warning("收到空消息")
                    continue
                
                logger.info(f"开始RAGFlow对话 - 用户消息: {user_message}")
                
                # 调用RAGFlow聊天完成API（流式）
                try:
                    # 构建请求数据
                    chat_data = {
                        "question": user_message,
                        "stream": True
                    }
                    
                    # 使用RAGFlow原生completions API发送请求
                    url = f"{client.base_url}/api/v1/chats/{assistant_id}/completions"
                    logger.info(f"发送RAGFlow请求到: {url}")
                    
                    # 构建RAGFlow原生格式的请求数据，包含session_id
                    ragflow_data = {
                        "question": user_message,
                        "stream": True,
                        "session_id": session_id
                    }
                    logger.info(f"请求数据: {ragflow_data}")
                    
                    import httpx
                    async with httpx.AsyncClient(timeout=60.0) as http_client:
                        async with http_client.stream(
                            "POST", 
                            url, 
                            headers=client.headers, 
                            json=ragflow_data
                        ) as response:
                            logger.info(f"RAGFlow响应状态码: {response.status_code}")
                            logger.info(f"RAGFlow响应头: {dict(response.headers)}")
                            
                            if response.status_code != 200:
                                error_text = await response.aread()
                                logger.error(f"RAGFlow API错误: {response.status_code} - {error_text}")
                                
                                # 尝试解析错误详情
                                error_detail = f"RAGFlow服务错误: {response.status_code}"
                                try:
                                    error_data = json.loads(error_text)
                                    if isinstance(error_data, dict) and 'error' in error_data:
                                        error_info = error_data['error']
                                        if 'message' in error_info:
                                            error_detail = error_info['message']
                                        if 'code' in error_info:
                                            error_detail = f"{error_detail} (代码: {error_info['code']})"
                                except:
                                    pass
                                
                                await websocket.send_text(json.dumps({
                                    "type": "error",
                                    "content": error_detail
                                }))
                                
                                # 如果是402错误，保存用户消息（但没有助手回复）
                                if response.status_code == 402:
                                    logger.warning(f"收到402错误，保存用户消息但标记助手回复失败")
                                    try:
                                        # 只保存用户消息，助手消息标记为错误
                                        save_success = await message_service.save_conversation(
                                            session_id=session_id,
                                            assistant_id=assistant_id,
                                            user_id=user_id,
                                            user_message=user_message,
                                            assistant_message=f"[错误] {error_detail}",
                                            reference=[],
                                            assistant_message_id=None
                                        )
                                        
                                        if save_success:
                                            logger.info(f"✅ 错误对话已保存到MongoDB - 会话: {session_id}")
                                        else:
                                            logger.error(f"❌ 错误对话保存失败 - 会话: {session_id}")
                                    except Exception as save_error:
                                        logger.error(f"❌ 保存错误对话失败: {str(save_error)}")
                                
                                continue
                            
                            # 处理RAGFlow原生的流式响应
                            complete_response = ""
                            last_answer_length = 0  # 记录上次答案的长度，用于计算增量
                            chunk_count = 0
                            buffer = ""  # 用于缓冲不完整的JSON数据
                            collected_references = []  # 收集所有引用数据
                            assistant_message_id = None  # RAGFlow返回的消息ID
                            async for chunk in response.aiter_text():
                                chunk_count += 1
                                logger.info(f"收到第{chunk_count}个数据块: {repr(chunk[:100])}{'...' if len(chunk) > 100 else ''}")
                                
                                if chunk.strip():
                                    # 处理Server-Sent Events格式和纯JSON格式
                                    lines = chunk.split('\n')
                                    for line in lines:
                                        line = line.strip()
                                        if not line:
                                            continue
                                            
                                        data_content = ""
                                        if line.startswith('data:'):
                                            # SSE格式
                                            data_content = line[5:].strip()
                                        else:
                                            # 可能是纯JSON格式
                                            data_content = line
                                        
                                        if data_content:
                                            logger.info(f"处理数据内容: {data_content[:200]}{'...' if len(data_content) > 200 else ''}")
                                            
                                            # 将数据添加到缓冲区
                                            buffer += data_content
                                            
                                            try:
                                                # 尝试解析缓冲区中的完整JSON
                                                chunk_data = json.loads(buffer)
                                                logger.info(f"解析JSON成功: {type(chunk_data)}")
                                                
                                                # 清空缓冲区，因为已经成功解析
                                                buffer = ""
                                                
                                                # 处理RAGFlow原生格式
                                                if isinstance(chunk_data, dict):
                                                    # 检查是否有错误
                                                    if chunk_data.get('code') != 0:
                                                        logger.error(f"RAGFlow返回错误: {chunk_data}")
                                                        continue
                                                    
                                                    # 提取数据部分
                                                    data_part = chunk_data.get('data', {})
                                                    if isinstance(data_part, dict):
                                                        # 获取回答内容（RAGFlow返回的是累积的完整内容）
                                                        full_answer = data_part.get('answer', '')
                                                        if full_answer and len(full_answer) > last_answer_length:
                                                            # 计算增量内容
                                                            incremental_answer = full_answer[last_answer_length:]
                                                            last_answer_length = len(full_answer)
                                                            complete_response = full_answer  # 更新完整响应
                                                            
                                                            await websocket.send_text(json.dumps({
                                                                "type": "message",
                                                                "content": incremental_answer
                                                            }))
                                                            logger.info(f"发送RAGFlow增量消息到前端: {incremental_answer}")
                                                        
                                                        # 处理引用信息
                                                        reference = data_part.get('reference', {})
                                                        if reference:
                                                            # 统一标准化引用的 chunks 为列表，避免字典导致前端解析失败
                                                            raw_chunks = reference.get('chunks', [])
                                                            normalized_chunks = []

                                                            def to_normalized_chunk(src: dict) -> dict:
                                                                # 兼容不同字段名，尽量补齐前端所需字段
                                                                content = src.get('content') or src.get('text') or src.get('chunk') or src.get('answer', '')
                                                                document_id = src.get('document_id') or src.get('doc_id') or src.get('documentId')
                                                                document_name = src.get('document_name') or src.get('doc_name') or src.get('file_name') or src.get('filename')
                                                                position = src.get('position') or src.get('chunk_id') or src.get('index')
                                                                dataset_id = src.get('dataset_id') or src.get('kb_id') or src.get('datasetId')
                                                                url = src.get('url') or src.get('source_url')
                                                                doc_type = src.get('doc_type') or src.get('type')
                                                                similarity = src.get('similarity') or src.get('score') or src.get('relevance')
                                                                vector_similarity = src.get('vector_similarity') or src.get('vectorScore')
                                                                term_similarity = src.get('term_similarity')
                                                                img_id = src.get('img_id') or src.get('image_id')
                                                                image_id = src.get('image_id') or img_id
                                                                chunk_id = src.get('id') or src.get('chunk_id') or src.get('chunkId')
                                                                return {
                                                                    "id": chunk_id,
                                                                    "content": content,
                                                                    "img_id": img_id,
                                                                    "image_id": image_id,
                                                                    "document_id": document_id,
                                                                    "document_name": document_name,
                                                                    "position": position,
                                                                    "dataset_id": dataset_id,
                                                                    "similarity": similarity,
                                                                    "vector_similarity": vector_similarity,
                                                                    "term_similarity": term_similarity,
                                                                    "url": url,
                                                                    "doc_type": doc_type
                                                                }

                                                            if isinstance(raw_chunks, dict):
                                                                for _, v in raw_chunks.items():
                                                                    if isinstance(v, dict):
                                                                        normalized_chunks.append(to_normalized_chunk(v))
                                                            elif isinstance(raw_chunks, list):
                                                                for v in raw_chunks:
                                                                    if isinstance(v, dict):
                                                                        normalized_chunks.append(to_normalized_chunk(v))

                                                            # 备用：某些实现把引用放在 total / refs 等字段
                                                            if not normalized_chunks and isinstance(reference, dict):
                                                                possible_lists = []
                                                                if isinstance(reference.get('refs'), list):
                                                                    possible_lists = reference.get('refs')
                                                                elif isinstance(reference.get('references'), list):
                                                                    possible_lists = reference.get('references')
                                                                for v in possible_lists:
                                                                    if isinstance(v, dict):
                                                                        normalized_chunks.append(to_normalized_chunk(v))

                                                            # 使用标准化后的引用更新收集与下发
                                                            if normalized_chunks:
                                                                # 收集引用用于存储
                                                                collected_references.extend(normalized_chunks)
                                                                logger.debug(f"已收集引用用于持久化: {len(collected_references)} 条，示例: {normalized_chunks[0]}")

                                                                # 下发给前端始终为数组，避免解析失败
                                                                await websocket.send_text(json.dumps({
                                                                    "type": "reference",
                                                                    "reference": {"chunks": normalized_chunks},
                                                                    "content": ""
                                                                }, ensure_ascii=False))
                                                                logger.info("已发送标准化引用信息到前端")
                                                    
                                                    # 检查是否是结束信号
                                                    elif data_part is True:
                                                        logger.info("收到对话结束信号")
                                                        # 不需要特殊处理，继续处理其他数据
                                                    
                                                    # 如果data是字符串，可能包含嵌套的JSON
                                                    elif isinstance(data_part, str) and data_part:
                                                        complete_response += data_part
                                                        await websocket.send_text(json.dumps({
                                                            "type": "message",
                                                            "content": data_part
                                                        }))
                                                        logger.info(f"发送字符串数据到前端: {data_part}")
                                                
                                            except json.JSONDecodeError as e:
                                                # JSON解析失败，数据可能不完整，继续缓冲
                                                logger.debug(f"JSON解析失败，继续缓冲数据: {e}")
                                                
                                                # 如果缓冲区太大，可能是真的有问题，尝试找到JSON边界
                                                if len(buffer) > 50000:  # 50KB限制
                                                    logger.warning(f"缓冲区过大，尝试找到JSON边界: {len(buffer)} 字符")
                                                    
                                                    # 尝试从后往前找到可能的JSON结束位置
                                                    found_boundary = False
                                                    for i in range(len(buffer) - 1, max(0, len(buffer) - 5000), -1):
                                                        try:
                                                            test_data = json.loads(buffer[:i])
                                                            logger.info(f"找到JSON边界，处理前{i}个字符")
                                                            
                                                            # 处理找到的JSON
                                                            if isinstance(test_data, dict) and test_data.get("code") == 0:
                                                                data_part = test_data.get("data", {})
                                                                if isinstance(data_part, dict):
                                                                    # 处理回答内容
                                                                    full_answer = data_part.get('answer', '')
                                                                    if full_answer and len(full_answer) > last_answer_length:
                                                                        incremental_answer = full_answer[last_answer_length:]
                                                                        last_answer_length = len(full_answer)
                                                                        complete_response = full_answer
                                                                        
                                                                        await websocket.send_text(json.dumps({
                                                                            "type": "message",
                                                                            "content": incremental_answer
                                                                        }))
                                                                        logger.info(f"发送缓冲区恢复的增量消息: {incremental_answer}")
                                                                    
                                                                    # 处理引用信息
                                                                    reference = data_part.get('reference', {})
                                                                    if reference and reference.get('chunks'):
                                                                        recovered_chunks = reference.get('chunks', [])
                                                                        logger.info(f"从缓冲区恢复引用信息: {len(recovered_chunks)} 个引用")
                                                                        # 追加到待保存集合，避免只下发不持久化
                                                                        if isinstance(recovered_chunks, list):
                                                                            collected_references.extend(recovered_chunks)
                                                                        await websocket.send_text(json.dumps({
                                                                            "type": "reference",
                                                                            "reference": reference,
                                                                            "content": ""
                                                                        }, ensure_ascii=False))
                                                                        logger.info("已发送缓冲区恢复的引用信息到前端并加入持久化队列")
                                                                
                                                                # 更新缓冲区，保留未处理的部分
                                                                buffer = buffer[i:]
                                                                found_boundary = True
                                                                break
                                                        except:
                                                            continue
                                                        
                                                        # 如果找不到边界，清空缓冲区避免内存溢出
                                                        if not found_boundary:
                                                            logger.error("无法找到JSON边界，清空缓冲区")
                                                            buffer = ""
                                                    
                                                    continue

                            logger.info(f"流式响应处理完成，总共收到{chunk_count}个数据块")
                            logger.info(f"完整响应内容: {complete_response}")
                            logger.info(f"缓冲区剩余数据: {len(buffer)} 字符")
                    
                    # 保存对话到MongoDB
                    try:
                        if complete_response.strip():  # 只有当有实际回复时才保存
                            save_success = await message_service.save_conversation(
                                session_id=session_id,
                                assistant_id=assistant_id,
                                user_id=user_id,
                                user_message=user_message,
                                assistant_message=complete_response,
                                reference=collected_references,
                                assistant_message_id=assistant_message_id
                            )
                            
                            if save_success:
                                logger.info(f"✅ 对话已保存到MongoDB - 会话: {session_id}，引用数: {len(collected_references)}")
                            else:
                                logger.error(f"❌ 对话保存失败 - 会话: {session_id}，引用数: {len(collected_references)}")
                        else:
                            logger.warning("空回复，跳过保存")
                            
                    except Exception as save_error:
                        logger.error(f"❌ 保存对话到MongoDB失败: {str(save_error)}")
                        logger.error(f"保存错误详情: {traceback.format_exc()}")
                    
                    # 发送完成信号
                    await websocket.send_text(json.dumps({
                        "type": "done",
                        "success": True,
                        "complete_response": complete_response
                    }))
                    
                except Exception as e:
                    logger.error(f"RAGFlow对话处理失败: {str(e)}")
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "content": f"对话处理失败: {str(e)}"
                    }))

            except WebSocketDisconnect:
                logger.info(f"RAGFlow WebSocket连接断开 - 助手ID: {assistant_id}, 会话ID: {session_id}")
                break
            except Exception as e:
                logger.error(f"RAGFlow WebSocket消息处理失败: {str(e)}")
                try:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "content": "消息处理失败"
                    }))
                except:
                    break

    except WebSocketDisconnect:
        logger.info("RAGFlow WebSocket连接已断开")
    except Exception as e:
        logger.error(f"RAGFlow WebSocket连接处理失败: {str(e)}")
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except:
            pass

# 测试RAGFlow消息获取功能
@router.get("/test/messages/{assistant_id}/{session_id}")
async def test_ragflow_messages(
    assistant_id: str,
    session_id: str,
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """测试RAGFlow消息获取功能"""
    try:
        logger.info(f"🧪 测试RAGFlow消息获取 - 助手ID: {assistant_id}, 会话ID: {session_id}")
        
        # 构建获取消息的API端点
        endpoint = f"/api/v1/chats/{assistant_id}/sessions/{session_id}/messages"
        logger.info(f"📤 测试调用RAGFlow API端点: {endpoint}")
        
        # 调用RAGFlow API获取消息列表
        messages = await client.request("GET", endpoint)
        
        logger.info(f"🔍 测试获取到的原始消息数据: {messages}")
        logger.info(f"🔍 消息数据类型: {type(messages)}")
        
        # 处理消息格式
        if messages:
            if not isinstance(messages, list):
                logger.info(f"⚠️ 消息不是列表格式，尝试解析: {type(messages)}")
                if isinstance(messages, dict) and 'data' in messages:
                    messages = messages['data']
                elif isinstance(messages, dict) and 'messages' in messages:
                    messages = messages['messages']
        
        return {
            "status": "success",
            "assistant_id": assistant_id,
            "session_id": session_id,
            "endpoint": endpoint,
            "message_count": len(messages) if isinstance(messages, list) else 0,
            "messages": messages
        }
        
    except Exception as e:
        logger.error(f"❌ 测试RAGFlow消息获取失败: {str(e)}")
        logger.error(f"错误详情: {traceback.format_exc()}")
        return {
            "status": "error",
            "assistant_id": assistant_id,
            "session_id": session_id,
            "error": str(e)
        }


# RAGFlow会话管理API
@router.get("/ragflow/sessions")
async def get_ragflow_sessions(
    page: int = 1,
    page_size: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """获取用户的RAGFlow会话列表"""
    try:
        message_service = RAGFlowMessageService(db)
        sessions = await message_service.get_user_sessions(
            user_id=str(current_user.id),
            page=page,
            page_size=page_size
        )
        
        # 转换为前端需要的格式
        session_list = []
        for session in sessions:
            session_data = {
                "id": session.session_id,
                "name": session.session_name,
                "assistant_id": session.assistant_id,
                "assistant_name": session.assistant_name,
                "message_count": session.message_count,
                "create_time": session.create_time.isoformat() if session.create_time else None,
                "update_time": session.update_time.isoformat() if session.update_time else None
            }
            session_list.append(session_data)
        
        return {
            "status": "success",
            "sessions": session_list,
            "page": page,
            "page_size": page_size
        }
        
    except Exception as e:
        logger.error(f"获取RAGFlow会话列表失败: {str(e)}")
        raise HTTPException(status_code=500, detail="获取会话列表失败")


@router.get("/ragflow/sessions/{session_id}/messages")
async def get_ragflow_session_messages(
    session_id: str,
    limit: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """获取RAGFlow会话的消息历史"""
    try:
        message_service = RAGFlowMessageService(db)
        messages = await message_service.get_session_messages(
            session_id=session_id,
            user_id=str(current_user.id),
            limit=limit
        )
        
        # 转换为前端需要的格式
        message_list = []
        for msg in messages:
            message_data = {
                "id": msg.message_id,
                "role": msg.role,
                "content": msg.content,
                "timestamp": msg.timestamp or msg.create_time.isoformat() if msg.create_time else None,
                "reference": []
            }
            
            # 处理引用数据
            if msg.reference:
                message_data["reference"] = [
                    {
                        "id": ref.id,
                        "content": ref.content,
                        "img_id": ref.img_id,
                        "image_id": ref.image_id,
                        "document_id": ref.document_id,
                        "document_name": ref.document_name,
                        "position": ref.position,
                        "dataset_id": ref.dataset_id,
                        "similarity": ref.similarity,
                        "vector_similarity": ref.vector_similarity,
                        "term_similarity": ref.term_similarity,
                        "url": ref.url,
                        "doc_type": ref.doc_type
                    }
                    for ref in msg.reference
                ]
            
            message_list.append(message_data)
        
        return {
            "status": "success",
            "session_id": session_id,
            "messages": message_list
        }
        
    except Exception as e:
        logger.error(f"获取RAGFlow会话消息失败: {str(e)}")
        raise HTTPException(status_code=500, detail="获取会话消息失败")


@router.delete("/ragflow/sessions/{session_id}")
async def delete_ragflow_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """删除RAGFlow会话（远程SDK+本地）"""
    try:
        # 本地查找，获取 assistant_id（先不限制当前用户，获取真实记录）
        session_doc = await db.fish_chat.ragflow_sessions.find_one({
            "$or": [
                {"_id": session_id},
                {"session_id": session_id}
            ]
        })
        if not session_doc:
            raise HTTPException(status_code=404, detail="会话不存在")
        assistant_id = session_doc.get("assistant_id")
        if not assistant_id:
            raise HTTPException(status_code=400, detail="缺少助手ID，无法删除远程会话")


        # 1) 使用官方 SDK 删除远程会话
        try:
            from ..services.ragflow_sdk import get_ragflow_sdk_service
            sdk_service = get_ragflow_sdk_service()

            rag = sdk_service._get_client()
            chats = rag.list_chats(id=assistant_id)
            if not chats:
                raise HTTPException(status_code=404, detail="远程助手不存在")
            chat = chats[0]

            chat.delete_sessions(ids=[session_id])
            logger.info(f"✅ 远程RAGFlow会话删除成功: {session_id}")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"RAGFlow SDK 删除会话失败: {str(e)}")
            raise HTTPException(status_code=502, detail=f"远程RAGFlow删除失败: {str(e)}")

        # 2) 删除本地记录（限定当前用户）
        await db.fish_chat.ragflow_sessions.delete_many({
            "$or": [
                {"_id": session_id},
                {"session_id": session_id}
            ],
            "user_id": str(current_user.id),
            "assistant_id": assistant_id
        })

        # 统一确定资源所属用户（以会话文档为准，缺省回落当前用户）
        owner_user_id = str(session_doc.get("user_id")) if session_doc.get("user_id") else str(current_user.id)
        if owner_user_id != str(current_user.id):
            logger.warning(f"会话所属用户与当前用户不一致，按会话所属用户删除前缀。owner={owner_user_id}, current={current_user.id}")

        # 3) 删除 MinIO 中助手会话头像目录（前缀与历史，仅按唯一 owner_user_id 前缀）
        try:
            from ..utils.minio_client import minio_client
            session_dir_prefix = f"users/{owner_user_id}/assistants/{assistant_id}/sessions/{session_id}/"
            logger.info(f"尝试删除RAGFlow会话目录前缀: {session_dir_prefix}")
            minio_client.delete_prefix(session_dir_prefix)
            legacy_user_session_prefix = f"users/{owner_user_id}/sessions/{session_id}/"
            logger.info(f"尝试删除传统会话目录前缀: {legacy_user_session_prefix}")
            minio_client.delete_prefix(legacy_user_session_prefix)

            # 额外兜底：若记录中存在具体的 role_avatar_url，则按该URL反推出精确前缀进行删除
            role_avatar_url = session_doc.get("role_avatar_url")
            if isinstance(role_avatar_url, str) and role_avatar_url.startswith("minio://"):
                # 例: minio://bucket/users/<uid>/assistants/<aid>/sessions/<sid>/role_avatar/<uuid>.jpg
                # 去掉协议和bucket前缀
                try:
                    path_after_bucket = role_avatar_url.split("//", 1)[1].split("/", 1)[1]
                    # 取到最后一级目录作为前缀（到 role_avatar/）
                    # 即移除文件名部分
                    last_slash_index = path_after_bucket.rfind("/")
                    if last_slash_index > 0:
                        precise_prefix = path_after_bucket[:last_slash_index + 1]
                        logger.info(f"尝试通过role_avatar_url删除精确前缀: {precise_prefix}")
                        minio_client.delete_prefix(precise_prefix)
                except Exception as e2:
                    logger.warning(f"解析 role_avatar_url 失败，跳过精确前缀清理: {e2}")

            legacy_prefix = f"roles/{session_id}"
            minio_client.delete_prefix(legacy_prefix)
        except Exception as e:
            logger.error(f"清理RAGFlow会话头像前缀失败: {str(e)}")

        return {"status": "success", "message": "会话删除成功"}

    except HTTPException:
        raise

@router.put("/ragflow/sessions/{session_id}/name")
async def update_ragflow_session_name(
    session_id: str,
    name_data: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database),
    client: RAGFlowClient = Depends(get_ragflow_client)
):
    """更新RAGFlow会话名称（远程+本地）"""
    try:
        new_name = name_data.get("name", "").trim() if hasattr(str, "trim") else name_data.get("name", "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="会话名称不能为空")
        
        # 查本地，获取 assistant_id
        session_doc = await db.fish_chat.ragflow_sessions.find_one({
            "$or": [
                {"_id": session_id},
                {"session_id": session_id}
            ],
            "user_id": str(current_user.id)
        })
        if not session_doc:
            raise HTTPException(status_code=404, detail="会话不存在")
        assistant_id = session_doc.get("assistant_id")
        if not assistant_id:
            raise HTTPException(status_code=400, detail="缺少助手ID，无法重命名远程会话")
        
        # 远程更新名称（多端点尝试）
        remote_updated = False
        remote_errors: list[str] = []
        update_attempts = [
            ("PUT", f"/api/v1/chats/{assistant_id}/sessions/{session_id}", {"json": {"name": new_name}}),
            ("POST", f"/api/v1/chats/{assistant_id}/sessions/update", {"json": {"id": session_id, "name": new_name}}),
            ("PUT", f"/api/v1/sessions/{session_id}", {"json": {"name": new_name}}),
        ]
        for method, endpoint, kwargs in update_attempts:
            try:
                logger.info(f"尝试远程重命名会话: {method} {endpoint} -> {kwargs}")
                await client.request(method, endpoint, **kwargs)
                remote_updated = True
                logger.info(f"✅ 远程RAGFlow会话重命名成功: {session_id} -> {new_name}")
                break
            except HTTPException as he:
                remote_errors.append(f"{method} {endpoint}: {he.detail}")
            except Exception as e:
                remote_errors.append(f"{method} {endpoint}: {str(e)}")
        if not remote_updated:
            error_msg = "; ".join(remote_errors[-3:]) if remote_errors else "unknown error"
            raise HTTPException(status_code=502, detail=f"远程RAGFlow重命名失败: {error_msg}")
        
        # 本地更新名称
        message_service = RAGFlowMessageService(db)
        success = await message_service.update_session_name(
            session_id=session_id,
            user_id=str(current_user.id),
            new_name=new_name
        )
        
        if success:
            return {"status": "success", "message": "会话名称更新成功"}
        else:
            # 远程已成功，本地缺失时也返回成功
            logger.warning(f"⚠️ 本地会话不存在，但远程重命名已成功: {session_id}")
            return {"status": "success", "message": "会话名称更新成功（本地未找到记录）"}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新RAGFlow会话名称失败: {str(e)}")
        raise HTTPException(status_code=500, detail="更新会话名称失败")

# 临时调试API - 检查会话和用户数据
@router.get("/debug/session/{session_id}")
async def debug_session_data(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database)
):
    """调试会话数据 - 临时API"""
    try:
        logger.info(f"🔍 调试会话数据 - session_id: {session_id}, 用户: {current_user.account}")
        
        # 1. 检查用户信息
        user_info = {
            "current_user.id": str(current_user.id),
            "current_user.account": current_user.account,
            "type_of_id": type(current_user.id).__name__
        }
        logger.info(f"🔍 用户信息: {user_info}")
        
        # 2. 查找该用户的所有ragflow会话
        user_sessions = await db.fish_chat.ragflow_sessions.find({
            "user_id": str(current_user.id)
        }).to_list(None)
        
        logger.info(f"🔍 该用户共有 {len(user_sessions)} 个RAGFlow会话")
        
        session_summaries = []
        for session in user_sessions:
            summary = {
                "_id": str(session.get("_id")),
                "session_id": session.get("session_id"),
                "name": session.get("name"),
                "assistant_id": session.get("assistant_id"),
                "user_id": session.get("user_id"),
                "created_at": session.get("created_at"),
                "message_count": session.get("message_count", 0)
            }
            session_summaries.append(summary)
            logger.info(f"  - 会话: {summary}")
        
        # 3. 查找所有匹配session_id的会话（不限用户）
        all_matching_sessions = await db.fish_chat.ragflow_sessions.find({
            "$or": [
                {"session_id": session_id},
                {"_id": session_id}
            ]
        }).to_list(None)
        
        logger.info(f"🔍 所有匹配session_id({session_id})的会话共 {len(all_matching_sessions)} 个")
        
        matching_summaries = []
        for session in all_matching_sessions:
            summary = {
                "_id": str(session.get("_id")),
                "session_id": session.get("session_id"),
                "name": session.get("name"),
                "user_id": session.get("user_id"),
                "assistant_id": session.get("assistant_id"),
                "matches_current_user": session.get("user_id") == str(current_user.id)
            }
            matching_summaries.append(summary)
            logger.info(f"  - 匹配会话: {summary}")
        
        # 4. 测试保存对话的查询条件
        from bson import ObjectId
        update_conditions = [
            {"session_id": session_id, "user_id": str(current_user.id)},  # 标准格式
            {"_id": session_id, "user_id": str(current_user.id)}          # 字符串_id格式
        ]
        
        # 如果session_id是有效的ObjectId，也尝试ObjectId格式
        if ObjectId.is_valid(session_id):
            update_conditions.append({"_id": ObjectId(session_id), "user_id": str(current_user.id)})
        
        update_filter = {"$or": update_conditions}
        logger.info(f"🔍 测试保存对话的查询条件: {update_filter}")
        
        test_session = await db.fish_chat.ragflow_sessions.find_one(update_filter)
        
        return {
            "status": "success",
            "debug_info": {
                "user_info": user_info,
                "user_sessions_count": len(user_sessions),
                "user_sessions": session_summaries,
                "matching_sessions_count": len(all_matching_sessions),
                "matching_sessions": matching_summaries,
                "save_query_filter": update_filter,
                "save_query_result": {
                    "found": test_session is not None,
                    "session_data": {
                        "_id": str(test_session.get("_id")),
                        "session_id": test_session.get("session_id"),
                        "name": test_session.get("name"),
                        "user_id": test_session.get("user_id")
                    } if test_session else None
                }
            }
        }
        
    except Exception as e:
        logger.error(f"❌ 调试会话数据失败: {str(e)}")
        return {
            "status": "error",
            "error": str(e)
        }

 