import os
import torch
from typing import List, Optional
from volcenginesdkarkruntime import Ark

from langchain_core.embeddings import Embeddings


class ArkEmbeddings(Embeddings):
    """
    基于火山引擎 Ark 的嵌入模型封装，遵循 LangChain Embeddings 接口。

    模块化设计要点：
    - 不做文件读取、文本切分、向量库写入等任何 I/O 或策略决策；
      仅专注于“字符串 -> 向量”的转换。
    - 查询与文档嵌入行为一致，查询可选携带指令前缀以优化检索。
    - 可选维度截断（MRL）与向量归一化由本类内部完成。

    参数:
    - api_key: 必填。由调用方传入。
    - model: Ark 嵌入模型名，默认 "doubao-embedding-large-text-250515"。
    - mrl_dim: 可选的向量维度截断（如 2048 / 1024 / 512 / 256）。None 表示不截断。
    - normalize: 是否对输出向量进行 L2 归一化，默认 True。
    - query_instruction: 查询指令前缀，is_query=True 时生效；None/空串表示不加指令。
    """

    def __init__(
        self,
        api_key: str,
        model: str = "doubao-embedding-large-text-250515",
        mrl_dim: Optional[int] = None,
        normalize: bool = True,
        query_instruction: Optional[str] = (
            "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: "
        ),
    ) -> None:
        if not api_key:
            raise ValueError("必须提供 api_key（由调用方传入）。")

        self.client = Ark(api_key=api_key)
        self.model = model
        self.mrl_dim = mrl_dim
        self.normalize = normalize
        self.query_instruction = query_instruction or ""

    def _prepare_inputs(self, inputs: List[str], is_query: bool) -> List[str]:
        if is_query and self.query_instruction:
            prefix = self.query_instruction
            return [f"{prefix}{text}" for text in inputs]
        return inputs

    def _encode(self, inputs: List[str], is_query: bool = False) -> List[List[float]]:
        processed_inputs = self._prepare_inputs(inputs, is_query=is_query)

        resp = self.client.embeddings.create(
            model=self.model,
            input=processed_inputs,
            encoding_format="float",
        )

        embedding_tensor = torch.tensor(
            [d.embedding for d in resp.data], dtype=torch.bfloat16
        )

        # 维度截断（若指定）
        if self.mrl_dim is not None and self.mrl_dim > 0:
            max_dim = embedding_tensor.shape[1]
            slice_dim = min(self.mrl_dim, max_dim)
            embedding_tensor = embedding_tensor[:, :slice_dim]

        # L2 归一化（可选）
        if self.normalize:
            embedding_tensor = torch.nn.functional.normalize(embedding_tensor, dim=1, p=2)

        return embedding_tensor.float().tolist()

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return self._encode(texts, is_query=False)

    def embed_query(self, text: str) -> List[float]:
        return self._encode([text], is_query=True)[0]


__all__ = ["ArkEmbeddings"]
