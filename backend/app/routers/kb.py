from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi import Depends
from typing import Optional
import os
import re
import uuid
import hashlib
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient

from ..utils.embedding.vector_store import ChromaVectorStore
from ..utils.embedding.pipeline import TextIngestionPipeline
from ..utils.embedding.volcengine_embedding import ArkEmbeddings  # noqa: F401 imported for type creation
from ..utils.embedding.all_mini_embedding import MiniLMEmbeddings  # noqa: F401
from ..utils.embedding.ollama_embedding import OllamaEmbeddings  # noqa: F401
from langchain_text_splitters import RecursiveCharacterTextSplitter
from ..utils.auth import get_current_user
from ..models.user import User
from ..database import get_database

from ..utils.embedding.pipeline import Retriever
from pydantic import BaseModel
from typing import List, Dict, Any

class KnowledgeRetrievalRequest(BaseModel):
    query: str
    kb_settings: dict
    top_k: Optional[int] = 3

class KnowledgeRetrievalResponse(BaseModel):
    success: bool
    results: List[Dict[str, Any]]
    error: Optional[str] = None

router = APIRouter()


def _sanitize_collection_name(name: str) -> str:
	"""
	Chroma constraints:
	- 3-63 chars
	- start/end alphanumeric
	- allowed: alnum, '_', '-'
	- no consecutive periods; we avoid '.' entirely
	- not an IPv4 address (we avoid by using letters)
	"""
	original_name = name  # 保存原始名称用于生成确定性哈希
	if not name:
		name = "kb"
	# Replace unsupported chars with '-'
	name = re.sub(r"[^A-Za-z0-9_-]", "-", name)
	# Collapse multiple '-' or '_' to single '-'
	name = re.sub(r"[-_]{2,}", "-", name)
	# Trim non-alnum from ends
	name = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", name)
	# Ensure minimum length by padding with deterministic suffix
	if len(name) < 3:
		# 使用原始名称的哈希值生成确定性的后缀
		original_hash = hashlib.md5(original_name.encode('utf-8')).hexdigest()[:6]
		name = f"kb-{original_hash}"
	# Enforce max length 63
	if len(name) > 63:
		name = name[:63]
	# Final guard: if ends with non-alnum after slice, fix
	name = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", name)
	# If empty again, fallback with deterministic hash
	if not name:
		# 使用原始输入名称生成确定性的名称
		original_hash = hashlib.md5(original_name.encode('utf-8')).hexdigest()[:6]
		name = f"kb-{original_hash}"
	return name


@router.get("/kb/user_settings")
async def get_user_kb_settings(
	current_user: User = Depends(get_current_user),
	db: AsyncIOMotorClient = Depends(get_database),
):
	"""获取当前用户上次保存的知识库配置（作为默认值）。"""
	try:
		col = db.fish_chat.user_kb_settings
		doc = await col.find_one({"user_id": str(current_user.id)})
		return {"kb_settings": (doc or {}).get("kb_settings", {})}
	except Exception as e:
		raise HTTPException(status_code=500, detail=f"查询用户知识库配置失败: {str(e)}")


@router.put("/kb/user_settings")
async def save_user_kb_settings(
	request: dict,
	current_user: User = Depends(get_current_user),
	db: AsyncIOMotorClient = Depends(get_database),
):
	"""保存当前用户的知识库默认配置。"""
	kb_settings = request.get("kb_settings") or {}
	# 不在此处修改用户输入的 collection_name，保留原始值（可能包含中文）
	try:
		col = db.fish_chat.user_kb_settings
		await col.update_one(
			{"user_id": str(current_user.id)},
			{"$set": {"user_id": str(current_user.id), "kb_settings": kb_settings}},
			upsert=True,
		)
		return {"ok": True}
	except Exception as e:
		raise HTTPException(status_code=500, detail=f"保存用户知识库配置失败: {str(e)}")


# 允许 Unicode 的文件夹名清洗（仅去除文件系统不允许或危险字符）
_def_fs_forbidden = r"[<>:\\/\|?*]"

def _sanitize_folder_name(name: str) -> str:
	name = name or "kb"
	# 去除非法字符
	name = re.sub(_def_fs_forbidden, "-", name)
	# 去掉首尾空白及点/空格（Windows 末尾点与空格不合法）
	name = name.strip().strip(". ")
	# 避免空字符串
	if not name:
		name = f"kb-{uuid.uuid4().hex[:6]}"
	# 限长，避免过长路径
	if len(name) > 100:
		name = name[:100].rstrip(". ")
	return name


def _build_components_from_kb_settings(kb_settings: dict):
	if not kb_settings or not kb_settings.get("enabled"):
		raise HTTPException(status_code=400, detail="知识库未启用或配置为空")

	provider = (kb_settings.get("embeddings") or {}).get("provider", "ollama")
	embed_model = (kb_settings.get("embeddings") or {}).get("model")
	base_url = (kb_settings.get("embeddings") or {}).get("base_url")
	api_key = (kb_settings.get("embeddings") or {}).get("api_key")
	local_model_path = (kb_settings.get("embeddings") or {}).get("local_model_path")

	# embeddings
	if provider == "ollama":
		if not base_url:
			base_url = "http://localhost:11434"
		if not embed_model:
			embed_model = "nomic-embed-text:v1.5"
		embeddings = OllamaEmbeddings(model=embed_model, base_url=base_url)
	elif provider == "local":
		model_path = local_model_path or "models/all-MiniLM-L6-v2"
		embeddings = MiniLMEmbeddings(model_name_or_path=model_path, max_length=512, batch_size=8, normalize=True)
	elif provider == "ark":
		if not api_key:
			raise HTTPException(status_code=400, detail="ArkEmbeddings 需要提供 api_key")
		if not embed_model:
			embed_model = "doubao-embedding-large-text-250515"
		embeddings = ArkEmbeddings(api_key=api_key, model=embed_model)
	else:
		raise HTTPException(status_code=400, detail=f"未知的嵌入模型提供商: {provider}")

	# splitter
	sp = kb_settings.get("split_params") or {}
	chunk_size = int(sp.get("chunk_size", 500))
	chunk_overlap = int(sp.get("chunk_overlap", 100))
	separators = sp.get("separators") or ["\n\n", "\n", "。", "！", "？", "，", " ", ""]
	splitter = RecursiveCharacterTextSplitter(
		chunk_size=chunk_size,
		chunk_overlap=chunk_overlap,
		separators=list(separators),
	)

	# vector store under backend/data/chromas/{folder_name}
	vector_db = kb_settings.get("vector_db", "chroma")
	if vector_db != "chroma":
		raise HTTPException(status_code=400, detail=f"当前仅支持 Chroma，收到: {vector_db}")
	collection_name_raw = kb_settings.get("collection_name") or "default"
	# Chroma collection 需 ASCII 安全
	collection_name = _sanitize_collection_name(collection_name_raw)
	# 文件夹名允许中文，仅去除文件系统非法字符
	folder_name = _sanitize_folder_name(collection_name_raw)
	
	# 添加调试日志
	print(f"🔍 调试信息:")
	print(f"  - collection_name_raw: {collection_name_raw}")
	print(f"  - collection_name (sanitized): {collection_name}")
	print(f"  - folder_name: {folder_name}")
	
	# Resolve absolute path anchored at the backend package root
	backend_pkg_root = Path(__file__).resolve().parents[2]  # .../backend
	persist_dir = str(backend_pkg_root.joinpath("data", "chromas", folder_name))
	
	print(f"  - persist_dir: {persist_dir}")
	print(f"  - 目录是否存在: {os.path.exists(persist_dir)}")
	if os.path.exists(persist_dir):
		print(f"  - 目录内容: {os.listdir(persist_dir)}")
	
	os.makedirs(persist_dir, exist_ok=True)

	vectorstore = ChromaVectorStore(
		embedding_function=embeddings,
		persist_directory=persist_dir,
		collection_name=collection_name,
	)

	return splitter, vectorstore


@router.post("/kb/upload_and_ingest")
async def upload_and_ingest(
	file: UploadFile = File(...),
	kb_settings_json: str = Form(...),
	session_id: Optional[str] = Form(default=None),
	current_user: User = Depends(get_current_user),
	db: AsyncIOMotorClient = Depends(get_database),
):
	"""
	上传单个文件并根据前端传入的 kb_settings 执行切分与向量化，
	向量数据持久化到 `backend/data/chromas/{collection}`。
	"""
	import json
	try:
		kb_settings = json.loads(kb_settings_json)
	except Exception:
		raise HTTPException(status_code=400, detail="kb_settings_json 不是合法的 JSON")

	if not file.filename:
		raise HTTPException(status_code=422, detail="缺少文件名")

	# 读取文本内容（仅处理文本/markdown/json等可读文本文件）
	try:
		content_bytes = await file.read()
		# 先尝试 utf-8
		try:
			text = content_bytes.decode("utf-8")
		except Exception:
			# 回退到 gbk
			try:
				text = content_bytes.decode("gbk")
			except Exception:
				raise HTTPException(status_code=415, detail="无法解码为文本（仅支持文本类文件）")
	except HTTPException:
		raise
	except Exception as e:
		raise HTTPException(status_code=500, detail=f"读取文件失败: {str(e)}")

	# 构建组件并入库
	splitter, vectorstore = _build_components_from_kb_settings(kb_settings)
	pipeline = TextIngestionPipeline(vector_store=vectorstore, text_splitter=splitter)
	num_docs = pipeline.ingest_text(text, file.filename)

	# 如果带有 session_id，则标记该会话的 kb_parsed = True 并保存 kb_settings
	if session_id:
		try:
			# 仅更新当前用户的该会话
			update_result = await db.fish_chat.chat_sessions.update_one(
				{"_id": session_id, "user_id": str(current_user.id)},
				{"$set": {
					"kb_parsed": True,
					"kb_settings": kb_settings  # 保存知识库配置到会话中
				}}
			)
			if update_result.matched_count == 0:
				raise HTTPException(status_code=404, detail="未找到会话或无权限")
		except HTTPException:
			raise
		except Exception as e:
			raise HTTPException(status_code=500, detail=f"更新会话解析状态失败: {str(e)}")

	return {"ok": True, "chunks": num_docs}


@router.post("/kb/retrieve", response_model=KnowledgeRetrievalResponse)
async def retrieve_knowledge(
    request: KnowledgeRetrievalRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorClient = Depends(get_database),
):
    """
    根据查询文本和会话的知识库配置进行向量检索，返回相关文档片段
    """
    try:
        # 检查知识库是否启用
        if not request.kb_settings or not request.kb_settings.get("enabled"):
            return KnowledgeRetrievalResponse(
                success=True,
                results=[],
                error="知识库未启用"
            )
        
        # 构建知识库组件
        _, vectorstore = _build_components_from_kb_settings(request.kb_settings)
        
        # 创建检索器
        retriever = Retriever(vector_store=vectorstore, top_k=request.top_k)
        
        # 执行检索
        search_results = retriever.search(request.query, top_k=request.top_k)
        
        # 格式化结果
        formatted_results = []
        for doc, score in search_results:
            formatted_results.append({
                "content": doc.page_content,
                "score": float(score),
                "metadata": doc.metadata
            })
        
        return KnowledgeRetrievalResponse(
            success=True,
            results=formatted_results
        )
        
    except Exception as e:
        return KnowledgeRetrievalResponse(
            success=False,
            results=[],
            error=f"检索失败: {str(e)}"
        ) 