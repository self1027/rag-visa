/** Safe diagnostics: never expose the PDF text or the upstream response body. */
export class EmbeddingError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  constructor(cause: unknown, provider = 'ollama') {
    const detail = cause instanceof Error ? cause.message : '';
    const status = (cause as { status_code?: unknown } | null)?.status_code;
    let code = 'service_error';
    let message = 'O Ollama não conseguiu gerar os embeddings. Verifique os logs do serviço.';
    if (/out of memory|not enough.*memory|requires more.*memory|cannot allocate memory/i.test(detail)) {
      code = 'memory'; message = 'O Ollama ficou sem memória ao gerar embeddings. Aumente a memória do Docker ou reduza o tamanho dos trechos e o contexto de embeddings.';
    } else if (/\bEOF\b|ECONNRESET|runner.*(?:exited|terminated|stopped)/i.test(detail)) {
      code = 'runner_stopped'; message = 'O processo de embeddings do Ollama encerrou a conexão (EOF). Verifique a memória do Docker; reduza CHUNK_MAX_LENGTH e EMBEDDING_CONTEXT_TOKENS ou aumente a memória disponível.';
    } else if (status === 404 || /model.*not found/i.test(detail)) {
      code = 'model_missing'; message = 'O modelo de embeddings não foi encontrado no Ollama. Instale o modelo indicado por EMBEDDING_MODEL.';
    } else if (/context length|context window|input length|too many tokens/i.test(detail)) {
      code = 'context_exceeded'; message = 'Um trecho excedeu o contexto do modelo de embeddings. Reduza CHUNK_MAX_LENGTH ou aumente EMBEDDING_CONTEXT_TOKENS. O texto não foi truncado.';
    } else if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(detail)) {
      code = 'unreachable'; message = 'Não foi possível conectar ao Ollama. Verifique OLLAMA_URL e se o serviço está em execução.';
    } else if (cause instanceof Error && cause.name === 'TimeoutError') {
      code = 'timeout'; message = 'O Ollama excedeu o tempo limite de embeddings. Verifique os recursos disponíveis e REQUEST_TIMEOUT_MS.';
    }
    if (provider !== 'ollama') message = message.replaceAll('O Ollama', 'O serviço de embeddings Python').replaceAll('ao Ollama', 'ao serviço de embeddings Python').replaceAll('no Ollama', 'no serviço de embeddings Python').replaceAll('do Ollama', 'do serviço de embeddings Python').replaceAll('OLLAMA_URL', 'EMBEDDING_URL');
    super(message, { cause });
    this.name = 'EmbeddingError'; this.code = code;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) this.statusCode = status;
  }
}
