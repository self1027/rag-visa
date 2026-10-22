"""Internal, offline Sentence Transformers service; prefixes are supplied by the RAG."""

import json
import logging
import os
import gc
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

import torch
from sentence_transformers import SentenceTransformer
from transformers import AutoModel, AutoTokenizer


def positive_int(name, default):
    value = int(os.environ.get(name, default))
    if value < 1:
        raise ValueError(f"Invalid {name}")
    return value


class Encoder:
    def __init__(self, config):
        torch.set_num_threads(positive_int("LOCAL_MODEL_THREADS", 2))
        self.name, self.revision = config["model"], config["revision"]
        self.pooling = config.get("pooling", "sentence-transformers")
        if self.pooling == "mean":
            self.tokenizer = AutoTokenizer.from_pretrained(config["path"], local_files_only=True)
            self.model = AutoModel.from_pretrained(config["path"], local_files_only=True).eval()
            max_context, dimensions = self.model.config.max_position_embeddings, self.model.config.hidden_size
            self.vocab_size = self.model.config.vocab_size
        else:
            self.model = SentenceTransformer(config["path"], device="cpu", local_files_only=True)
            self.tokenizer = self.model.tokenizer
            max_context, dimensions = self.model.max_seq_length, self.model.get_sentence_embedding_dimension()
            self.vocab_size = self.model[0].auto_model.config.vocab_size
        self.context, self.dimensions = config["contextTokens"], config["dimensions"]
        if self.context > max_context or self.dimensions != dimensions:
            raise ValueError("Model dimensions/context mismatch")
        self.max_body = positive_int("EMBEDDING_MAX_BODY_BYTES", 65536)
        self.timeout = positive_int("REQUEST_TIMEOUT_MS", 120000) / 1000
        self.lock = Lock()

    def health(self, model=None):
        if model and model != self.name:
            raise KeyError(model)
        return {"model": self.name, "revision": self.revision, "dimensions": self.dimensions, "contextTokens": self.context}

    def encode(self, body):
        if not isinstance(body, dict):
            return 400, {"code": "invalid_request"}
        if body.get("model") != self.name:
            return 404, {"code": "model_missing"}
        text = body.get("input")
        context = body.get("contextTokens", self.context)
        if (not isinstance(text, str) or not text.strip() or type(context) is not int
                or not 1 <= context <= self.context):
            return 400, {"code": "invalid_request"}
        if not self.lock.acquire(timeout=self.timeout):
            return 503, {"code": "busy"}
        try:
            ids = self.tokenizer.encode(text)
            if len(ids) > context:
                return 422, {"code": "context_exceeded"}
            if any(token >= self.vocab_size for token in ids):
                return 400, {"code": "unsupported_token"}
            with torch.inference_mode():
                if self.pooling == "mean":
                    tokens = self.tokenizer(text, return_tensors="pt", return_special_tokens_mask=True, truncation=False)
                    mask = (tokens.attention_mask * (1 - tokens.pop("special_tokens_mask"))).unsqueeze(-1)
                    if not (mask.sum(dim=1) > 0).all():
                        return 400, {"code": "invalid_request"}
                    hidden = self.model(**tokens).last_hidden_state
                    vector = torch.nn.functional.normalize((hidden * mask).sum(dim=1) / mask.sum(dim=1), dim=1)[0]
                else:
                    vector = self.model.encode([text], prompt="", normalize_embeddings=True,
                                               convert_to_tensor=True, batch_size=1)[0]
            if vector.shape != (self.dimensions,) or not torch.isfinite(vector).all():
                raise RuntimeError("Invalid model output")
            return 200, {"model": self.name, "embeddings": [vector.tolist()]}
        finally:
            self.lock.release()


class ModelRouter:
    def __init__(self):
        self.name = os.environ["EMBEDDING_MODEL"]
        default = {"model": self.name, "revision": os.environ["EMBEDDING_REVISION"],
                   "path": os.environ["EMBEDDING_MODEL_PATH"], "pooling": "sentence-transformers",
                   "contextTokens": positive_int("EMBEDDING_CONTEXT_TOKENS", 2048),
                   "dimensions": positive_int("EMBEDDING_DIMENSIONS", 768)}
        self.configs = {self.name: default}
        for config in json.loads(os.environ.get("EMBEDDING_MODELS", "[]")):
            if (config["model"] in self.configs or config.get("pooling") not in ("mean", "sentence-transformers")
                    or type(config["dimensions"]) is not int or config["dimensions"] < 1
                    or type(config["contextTokens"]) is not int or config["contextTokens"] < 1):
                raise ValueError("Invalid EMBEDDING_MODELS")
            self.configs[config["model"]] = config
        for config in self.configs.values():
            if not (Path(config["path"]) / "config.json").is_file():
                raise ValueError("Local model files missing")
        self.max_body = positive_int("EMBEDDING_MAX_BODY_BYTES", 65536)
        self.timeout = positive_int("REQUEST_TIMEOUT_MS", 120000) / 1000
        self.lock = Lock()
        self.encoder = Encoder(default)

    def health(self, model=None):
        config = self.configs[model or self.name]
        return {key: config[key] for key in ("model", "revision", "dimensions", "contextTokens")}

    def encode(self, body):
        if not isinstance(body, dict):
            return 400, {"code": "invalid_request"}
        config = self.configs.get(body.get("model")) if isinstance(body.get("model"), str) else None
        if not config:
            return 404, {"code": "model_missing"}
        if not self.lock.acquire(timeout=self.timeout):
            return 503, {"code": "busy"}
        try:
            if self.encoder is None or self.encoder.name != config["model"]:
                # Keep only one model resident to fit the local CPU deployment.
                self.encoder = None
                gc.collect()
                self.encoder = Encoder(config)
            return self.encoder.encode(body)
        finally:
            self.lock.release()


def handler_for(encoder):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(encoder.timeout)

        def respond(self, status, body):
            data = json.dumps(body, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            url = urlsplit(self.path)
            if url.path != "/health":
                return self.respond(404, {"code": "not_found"})
            try:
                self.respond(200, encoder.health(parse_qs(url.query).get("model", [None])[0]))
            except KeyError:
                self.respond(404, {"code": "model_missing"})

        def do_POST(self):
            if self.path != "/api/embed":
                return self.respond(404, {"code": "not_found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= encoder.max_body:
                    return self.respond(413, {"code": "body_too_large"})
                if self.headers.get_content_type() != "application/json":
                    return self.respond(415, {"code": "invalid_content_type"})
                body = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeError):
                return self.respond(400, {"code": "invalid_json"})
            except (TimeoutError, ConnectionError):
                return
            try:
                status, response = encoder.encode(body)
            except Exception as error:
                # Never log request text or exception messages containing tokenizer input.
                logging.error("embedding_failed error_type=%s", type(error).__name__)
                status, response = 500, {"code": "service_error"}
            self.respond(status, response)

        def log_message(self, *_args):
            pass

    return Handler


if __name__ == "__main__":
    encoder = ModelRouter()
    server = ThreadingHTTPServer((os.environ.get("EMBEDDING_BIND_HOST", "127.0.0.1"),
                                  positive_int("EMBEDDING_PORT", 8001)), handler_for(encoder))
    logging.warning("embeddings_ready model=%s", encoder.name)
    server.serve_forever()
