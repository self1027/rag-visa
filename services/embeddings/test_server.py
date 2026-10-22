import json
from threading import Lock, Thread
from types import SimpleNamespace
from unittest.mock import patch
import tempfile
from pathlib import Path
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer

import torch
from server import Encoder, ModelRouter, handler_for


class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.encoder = Encoder.__new__(Encoder)
        self.encoder.name = "test-model"
        self.encoder.revision = "test-revision"
        self.encoder.context = 8
        self.encoder.dimensions = 768
        self.encoder.max_body = 512
        self.encoder.timeout = 1
        self.encoder.lock = Lock()
        self.encoder.pooling = 'sentence-transformers'
        self.encoder.vocab_size = 65536

        class Model:
            tokenizer = SimpleNamespace(encode=lambda text: list(range(len(text.split()))))

            def __getitem__(self, _key):
                return SimpleNamespace(auto_model=SimpleNamespace(config=SimpleNamespace(vocab_size=65536)))

            def encode(self, *_args, **_kwargs):
                return torch.nn.functional.normalize(torch.ones((1, 768)), dim=1)

        self.encoder.model = Model()
        self.encoder.tokenizer = self.encoder.model.tokenizer

    def test_validation_and_no_silent_truncation(self):
        for body in [None, [], {"model": "test-model", "input": " "},
                     {"model": "test-model", "input": "text", "contextTokens": True}]:
            self.assertEqual(self.encoder.encode(body)[0], 400)
        self.assertEqual(self.encoder.encode({"model": "wrong", "input": "text"})[0], 404)
        self.assertEqual(self.encoder.encode({"model": "test-model", "input": "word " * 9}),
                         (422, {"code": "context_exceeded"}))
        status, result = self.encoder.encode({"model": "test-model", "input": "word"})
        self.assertEqual(status, 200)
        self.assertEqual(len(result["embeddings"][0]), 768)

    def test_http_health_and_input_limits(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.encoder))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urlopen(base + "/health") as response:
                self.assertEqual(json.load(response)["revision"], "test-revision")
            for data, code in [(b"x", 400), (b"x" * 513, 413)]:
                with self.assertRaises(HTTPError) as caught:
                    urlopen(Request(base + "/api/embed", data=data, headers={"Content-Type": "application/json"}))
                self.assertEqual(caught.exception.code, code)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_router_loads_one_model_at_a_time_and_reports_available_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, 'config.json').write_text('{}')
            other = {"model": "other-model", "revision": "other-revision", "path": folder,
                     "pooling": "mean", "dimensions": 768, "contextTokens": 512}
            loaded = []

            class FakeEncoder:
                def __init__(self, config):
                    self.name = config['model']
                    loaded.append(self.name)

                def encode(self, _body):
                    return 200, {'model': self.name}

            with patch.dict('os.environ', {"EMBEDDING_MODEL": "test-model", "EMBEDDING_REVISION": "revision",
                                           "EMBEDDING_MODEL_PATH": folder, "EMBEDDING_MODELS": json.dumps([other])}), patch('server.Encoder', FakeEncoder):
                router = ModelRouter()
                self.assertEqual(router.health('other-model')['contextTokens'], 512)
                self.assertEqual(loaded, ['test-model'])
                self.assertEqual(router.encode({'model': 'other-model'})[1]['model'], 'other-model')
                router.encode({'model': 'other-model'})
                self.assertEqual(loaded, ['test-model', 'other-model'])
                router.encode({'model': 'test-model'})
                self.assertEqual(loaded, ['test-model', 'other-model', 'test-model'])


if __name__ == "__main__":
    unittest.main()
