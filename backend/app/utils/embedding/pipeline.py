import os
import uuid
from typing import List, Optional, Tuple

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

from .vector_store import VectorStoreLike


class TextIngestionPipeline:
	"""
	纯编排类：
	- 负责文本读取、切分与构建 `Document` 列表
	- 向外部注入的 `VectorStoreLike` 执行 add_documents
	- 不关心具体向量库与嵌入模型细节
	"""

	def __init__(
		self,
		vector_store: VectorStoreLike,
		text_splitter: Optional[RecursiveCharacterTextSplitter] = None,
		id_factory=lambda: str(uuid.uuid4()),
	):
		self.vector_store = vector_store
		self.text_splitter = text_splitter or RecursiveCharacterTextSplitter(
			chunk_size=500,
			chunk_overlap=100,
			separators=["\n\n", "\n", "。", "！", "？", "，", " ", ""],
		)
		self.id_factory = id_factory

	def build_documents_from_text(self, text: str, source_path: str) -> List[Document]:
		chunks = self.text_splitter.split_text(text)
		docs: List[Document] = []
		for idx, chunk in enumerate(chunks):
			docs.append(
				Document(
					page_content=chunk,
					metadata={"source": source_path, "chunk_index": idx},
				)
			)
		return docs

	def ingest_text(self, text: str, source_path: str) -> int:
		docs = self.build_documents_from_text(text, source_path)
		ids = [self.id_factory() for _ in docs]
		self.vector_store.add_documents(docs, ids=ids)
		return len(docs)


class Retriever:
	"""
	与具体向量库解耦的检索器，依赖注入 `VectorStoreLike`。
	"""

	def __init__(self, vector_store: VectorStoreLike, top_k: int = 3) -> None:
		self.vector_store = vector_store
		self.top_k = top_k

	def search(self, query: str, top_k: Optional[int] = None):
		k = top_k if top_k is not None else self.top_k
		return self.vector_store.similarity_search_with_score(query, k=k)


__all__ = ["TextIngestionPipeline", "Retriever"] 