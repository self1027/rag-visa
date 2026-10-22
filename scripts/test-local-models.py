"""Smoke test local models offline; optional arguments replace the sample texts."""

import json
import os
from pathlib import Path
import sys

import torch
from sentence_transformers import SentenceTransformer
from transformers import AutoModel, AutoTokenizer


def summarize(name, vectors):
    if vectors.shape != (len(texts), 768) or not torch.isfinite(vectors).all():
        raise RuntimeError(f"{name}: embeddings inválidos: {vectors.shape}")
    norms = vectors.norm(dim=1)
    if not torch.allclose(norms, torch.ones_like(norms), atol=1e-4):
        raise RuntimeError(f"{name}: embeddings não normalizados")
    return {"model": name, "shape": list(vectors.shape),
            "norms": norms.tolist(), "cosine_similarity": (vectors @ vectors.T).tolist()}


if __name__ == "__main__":
    torch.set_num_threads(int(os.environ.get("LOCAL_MODEL_THREADS", "2")))
    root = Path(os.environ.get("LOCAL_MODELS_DIR", "data/models"))
    texts = sys.argv[1:] or [
        "A vigilância sanitária fiscaliza a higiene dos restaurantes.",
        "Restaurantes devem cumprir as normas sanitárias de higiene.",
        "O planeta Júpiter possui muitas luas.",
    ]
    if any(not text.strip() for text in texts):
        raise ValueError("Os textos não podem ser vazios")

    with torch.inference_mode():
        gemma = SentenceTransformer(str(root / "embeddinggemma-pt-br"),
                                    device="cpu", local_files_only=True)
        for text in texts:
            if len(gemma.tokenizer.encode(text)) > gemma.max_seq_length:
                raise ValueError("Texto excede o contexto do EmbeddingGemma")
        vectors = gemma.encode(texts, prompt="", normalize_embeddings=True,
                               convert_to_tensor=True, batch_size=1)
        results = [summarize("tardellirs/embeddinggemma-pt-br", vectors)]
        del gemma

        bert_path = str(root / "bert-base-portuguese-cased")
        tokenizer = AutoTokenizer.from_pretrained(bert_path, local_files_only=True)
        bert = AutoModel.from_pretrained(bert_path, local_files_only=True).eval()
        tokens = tokenizer(texts, padding=True, return_tensors="pt",
                           return_special_tokens_mask=True, truncation=False)
        if tokens.input_ids.shape[1] > bert.config.max_position_embeddings:
            raise ValueError("Texto excede o contexto do BERTimbau")
        special = tokens.pop("special_tokens_mask")
        mask = (tokens.attention_mask * (1 - special)).unsqueeze(-1)
        if not (mask.sum(dim=1) > 0).all():
            raise ValueError("Texto sem tokens de conteúdo")
        hidden = bert(**tokens).last_hidden_state
        vectors = (hidden * mask).sum(dim=1) / mask.sum(dim=1)
        vectors = torch.nn.functional.normalize(vectors, dim=1)
        results.append(summarize("neuralmind/bert-base-portuguese-cased (mean pooling)", vectors))

    print(json.dumps({"texts": texts, "results": results}, ensure_ascii=False, indent=2))
