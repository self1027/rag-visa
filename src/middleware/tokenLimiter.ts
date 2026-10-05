import { ChatMessage } from '../rag/generator.js';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function enforceTokenLimit(history: ChatMessage[], maxAllowedTokens: number = 5000): ChatMessage[] {
  let currentHistory = [...history];
  
  while (currentHistory.length > 0) {
    let totalTokens = 0;
    
    for (const msg of currentHistory) {
      totalTokens += estimateTokens(msg.content) + 5; 
    }

    if (totalTokens <= maxAllowedTokens) {
      break;
    }

    currentHistory.shift();
  }

  return currentHistory;
}