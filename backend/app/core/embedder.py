from sentence_transformers import SentenceTransformer
from app.core.config import settings

_model: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(settings.embed_model)
    return _model


def embed_text(text: str) -> list[float]:
    return _get_model().encode(text, convert_to_numpy=True).tolist()


def embed_batch(texts: list[str]) -> list[list[float]]:
    return _get_model().encode(texts, convert_to_numpy=True).tolist()
