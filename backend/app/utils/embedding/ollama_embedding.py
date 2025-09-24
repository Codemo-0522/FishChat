import json
import time
from typing import List, Optional

import requests


class OllamaEmbeddings:
    """Embedding wrapper compatible with LangChain's embedding_function interface.

    Calls local Ollama server's /api/embeddings endpoint.
    """

    def __init__(
        self,
        model: str = "all-minilm:33m",#nomic-embed-text:v1.5
        base_url: str = "http://localhost:11434",
        timeout_seconds: int = 60,
        max_retries: int = 3,
        retry_backoff_seconds: float = 1.0,
    ) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.retry_backoff_seconds = retry_backoff_seconds
        self._session = requests.Session()

    def _embed_one(self, text: str) -> List[float]:
        url = f"{self.base_url}/api/embeddings"
        payload = {"model": self.model, "prompt": text}
        last_err: Optional[Exception] = None
        for attempt in range(1, self.max_retries + 1):
            try:
                resp = self._session.post(
                    url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    timeout=self.timeout_seconds,
                )
                resp.raise_for_status()
                data = resp.json()
                emb = data.get("embedding")
                if not isinstance(emb, list):
                    raise ValueError(f"Unexpected response (no 'embedding'): {data}")
                return emb
            except Exception as e:
                last_err = e
                if attempt < self.max_retries:
                    time.sleep(self.retry_backoff_seconds * attempt)
                else:
                    raise RuntimeError(
                        f"Ollama embeddings request failed after {self.max_retries} attempts: {last_err}"
                    )
        raise RuntimeError("Unreachable")

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return [self._embed_one(t) for t in texts]

    def embed_query(self, text: str) -> List[float]:
        return self._embed_one(text)


__all__ = ["OllamaEmbeddings"] 