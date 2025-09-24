from typing import List, Tuple, Optional, Iterable

try:
	# 避免强依赖：只有在使用 Chroma 时才需要安装该包
	from langchain_chroma import Chroma
	_CHROMA_AVAILABLE = True
except Exception:
	Chroma = None  # type: ignore
	_CHROMA_AVAILABLE = False

from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings


class VectorStoreLike:
	"""
	最小向量库协议。仅定义本项目需要的核心方法，便于切换不同后端。
	调用方可以自行实现兼容此接口的类（如 Pinecone、Milvus、FAISS 等）。
	"""

	def add_documents(self, documents: List[Document], ids: Optional[List[str]] = None) -> None:  # pragma: no cover - interface
		raise NotImplementedError

	def similarity_search_with_score(self, query: str, k: int = 4) -> List[Tuple[Document, float]]:  # pragma: no cover - interface
		raise NotImplementedError


class ChromaVectorStore(VectorStoreLike):
	"""
	Chroma 的轻量封装。通过传入 Embeddings 与持久化参数进行构造，避免在
	项目其他模块中出现对 Chroma 的直接依赖。
	"""

	def __init__(
		self,
		embedding_function: Embeddings,
		persist_directory: Optional[str] = None,
		collection_name: Optional[str] = None,
		client_settings: Optional[dict] = None,
	):
		if not _CHROMA_AVAILABLE:
			raise RuntimeError("未安装 langchain-chroma，无法使用 ChromaVectorStore。请执行: pip install -U langchain-chroma")

		kwargs = {
			"embedding_function": embedding_function,
			"persist_directory": persist_directory,
			"collection_name": collection_name,
		}
		if client_settings is not None:
			kwargs["client_settings"] = client_settings

		self._store = Chroma(**kwargs)

	def add_documents(self, documents: List[Document], ids: Optional[List[str]] = None) -> None:
		self._store.add_documents(documents, ids=ids)

	def similarity_search_with_score(self, query: str, k: int = 4) -> List[Tuple[Document, float]]:
		return self._store.similarity_search_with_score(query, k=k)


__all__ = ["VectorStoreLike", "ChromaVectorStore"] 