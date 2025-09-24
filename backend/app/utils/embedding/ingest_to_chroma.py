import os
import sys
from typing import List

from langchain_text_splitters import RecursiveCharacterTextSplitter

from volcengine_embedding import ArkEmbeddings
from all_mini_embedding import MiniLMEmbeddings
from ollama_embedding import OllamaEmbeddings

from vector_store import ChromaVectorStore
from pipeline import TextIngestionPipeline


def build_components_from_kb_settings(kb_settings: dict):
    """
    根据会话内保存的 kb_settings 构建：
    - embeddings 实例（Ark/MiniLM/Ollama）
    - text_splitter（递归切分，支持自定义 chunk_size/overlap/separators）
    - vectorstore（当前仅支持 Chroma）

    期望的 kb_settings 结构示例：
    {
        "enabled": true,
        "vector_db": "chroma",
        "collection_name": "my_collection",
        "embeddings": {
            "provider": "ollama" | "local" | "ark",
            "model": "nomic-embed-text:v1.5" | "all-MiniLM-L6-v2" | "doubao-embedding-large-text-250515",
            "base_url": "http://localhost:11434",          # 仅 ollama
            "api_key": "...",                               # 仅 ark
            "local_model_path": "models/all-MiniLM-L6-v2"   # 仅 local
        },
        "split_params": {
            "chunk_size": 500,
            "chunk_overlap": 100,
            "separators": ["\n\n", "\n", "。", "！", "？", "，", " ", ""]
        }
    }
    """
    if not kb_settings or not kb_settings.get("enabled"):
        raise ValueError("知识库未启用或配置为空")

    provider = (kb_settings.get("embeddings") or {}).get("provider", "ollama")
    embed_model = (kb_settings.get("embeddings") or {}).get("model")
    base_url = (kb_settings.get("embeddings") or {}).get("base_url")
    api_key = (kb_settings.get("embeddings") or {}).get("api_key")
    local_model_path = (kb_settings.get("embeddings") or {}).get("local_model_path")

    # 1) embeddings
    if provider == "ollama":
        if not base_url:
            base_url = "http://localhost:11434"
        if not embed_model:
            embed_model = "nomic-embed-text:v1.5"
        embeddings = OllamaEmbeddings(model=embed_model, base_url=base_url)
    elif provider == "local":
        # 默认路径兼容前端
        model_path = local_model_path or "models/all-MiniLM-L6-v2"
        embeddings = MiniLMEmbeddings(model_name_or_path=model_path, max_length=512, batch_size=8, normalize=True)
    elif provider == "ark":
        if not api_key:
            raise ValueError("ArkEmbeddings 需要提供 api_key")
        if not embed_model:
            embed_model = "doubao-embedding-large-text-250515"
        embeddings = ArkEmbeddings(api_key=api_key, model=embed_model)
    else:
        raise ValueError(f"未知的嵌入模型提供商: {provider}")

    # 2) text splitter
    sp = kb_settings.get("split_params") or {}
    chunk_size = int(sp.get("chunk_size", 500))
    chunk_overlap = int(sp.get("chunk_overlap", 100))
    separators = sp.get("separators") or ["\n\n", "\n", "。", "！", "？", "，", " ", ""]
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=list(separators),
    )

    # 3) vector store (Chroma)
    vector_db = kb_settings.get("vector_db", "chroma")
    if vector_db != "chroma":
        raise ValueError(f"当前仅支持 Chroma，收到: {vector_db}")

    collection_name = kb_settings.get("collection_name") or "default"
    base_persist_dir = os.path.join(os.getcwd(), "chroma_db")
    persist_dir = os.path.join(base_persist_dir, collection_name)

    vectorstore = ChromaVectorStore(
        embedding_function=embeddings,
        persist_directory=persist_dir,
        collection_name=collection_name,
    )

    return embeddings, splitter, vectorstore


def read_text_file(file_path: str) -> str:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"找不到文件: {file_path}")
    with open(file_path, "r", encoding="utf-8") as f:
        return f.read()


def _prompt_int(prompt: str, default: int) -> int:
    raw = input(f"{prompt} (默认 {default}): ").strip()
    if raw == "":
        return default
    try:
        return int(raw)
    except Exception:
        print("输入无效，已使用默认值。")
        return default


def _prompt_select_embeddings() -> object:
    print("请选择嵌入模型：")
    print("  1) 火山引擎 ArkEmbeddings")
    print("  2) 本地 MiniLMEmbeddings (sentence-transformers/all-MiniLM-L6-v2)")
    print("  3) 本地 Ollama Embeddings (可选模型，如 nomic-embed-text:v1.5)")
    choice = input("输入序号并回车 (默认 2): ").strip() or "2"

    if choice == "1":
        api_key = input("请输入 ARK_API_KEY: ").strip()
        if not api_key:
            raise ValueError("未提供 ARK_API_KEY。")
        model = input("Ark 模型名 (默认 doubao-embedding-large-text-250515): ").strip() or "doubao-embedding-large-text-250515"
        print("将使用 ArkEmbeddings。")
        return ArkEmbeddings(api_key=api_key, model=model)

    if choice == "3":
        base_url = input("Ollama 服务地址 (默认 http://localhost:11434): ").strip() or "http://localhost:11434"
        model_name = input("Ollama 模型名称 (例如 nomic-embed-text:v1.5): ").strip() or "nomic-embed-text:v1.5"
        print(f"将使用 OllamaEmbeddings（model={model_name}）。")
        return OllamaEmbeddings(model=model_name, base_url=base_url)

    # MiniLM 选项
    model_path = input(
        "可选：MiniLM 本地模型目录（如 models/all-MiniLM-L6-v2），留空则使用在线模型名: "
    ).strip() or None
    max_length = _prompt_int("可选：max_length", 512)
    batch_size = _prompt_int("可选：batch_size", 8)
    print("将使用 MiniLMEmbeddings。")
    return MiniLMEmbeddings(
        model_name_or_path=model_path,
        max_length=max_length,
        batch_size=batch_size,
        normalize=True,
    )


def _prompt_text_splitter() -> RecursiveCharacterTextSplitter:
    print("\n配置文本切分参数（直接回车使用默认）")
    chunk_size = _prompt_int("chunk_size", 500)
    chunk_overlap = _prompt_int("chunk_overlap", 100)
    print("分隔符策略： 1) 中文标点+空白  2) 仅换行  3) 使用库默认")
    sep_choice = input("选择 1/2/3 (默认 1): ").strip() or "1"

    if sep_choice == "2":
        separators: List[str] = ["\n\n", "\n"]
        return RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separators=list(separators),
        )
    if sep_choice == "3":
        return RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
    # 默认：中文标点+空白
    separators = ["\n\n", "\n", "。", "！", "？", "，", " ", ""]
    return RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=list(separators),
    )


def _prompt_kb_name(default_name: str = "default") -> str:
    name = input(f"请输入向量文件夹名称以区分知识库 (默认 {default_name}): ").strip()
    return name or default_name


def ingest_to_vectorstore(
    source_file: str,
    base_persist_dir: str,
    collection_name: str = None,
) -> None:
    kb_name = _prompt_kb_name()
    persist_dir = os.path.join(base_persist_dir, kb_name)
    if collection_name is None:
        collection_name = kb_name

    print("读取并切分文本中...")
    full_text = read_text_file(source_file)

    print("初始化嵌入模型与向量数据库...")
    embeddings = _prompt_select_embeddings()
    splitter = _prompt_text_splitter()
    vectorstore = ChromaVectorStore(
        embedding_function=embeddings,
        persist_directory=persist_dir,
        collection_name=collection_name,
    )

    pipeline = TextIngestionPipeline(vector_store=vectorstore, text_splitter=splitter)

    print("向量化并入库中...")
    num_docs = pipeline.ingest_text(full_text, source_file)
    print(f"入库完成，文档块数量: {num_docs}，已持久化到: {persist_dir} (collection={collection_name})")


if __name__ == "__main__":
    try:
        SOURCE_FILE = os.path.join("知识库原文件", "小缘.txt")
        BASE_PERSIST_DIR = os.path.join(os.getcwd(), "chroma_db")
        ingest_to_vectorstore(SOURCE_FILE, BASE_PERSIST_DIR)
    except Exception as e:
        print(f"[错误] {e}", file=sys.stderr)
        sys.exit(1) 