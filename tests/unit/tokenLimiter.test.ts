import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimateTokens, enforceTokenLimit } from '../../src/middleware/tokenLimiter.js';
import { ChatMessage } from '../../src/rag/generator.js';

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should return 1 for very short text', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('hi')).toBe(1);
  });

  it('should estimate tokens based on character count / 3.5', () => {
    // 35 chars / 3.5 = 10 tokens
    expect(estimateTokens('a'.repeat(35))).toBe(10);
    
    // 70 chars / 3.5 = 20 tokens
    expect(estimateTokens('a'.repeat(70))).toBe(20);
    
    // 100 chars / 3.5 = 28.57 -> ceil = 29
    expect(estimateTokens('a'.repeat(100))).toBe(29);
  });

  it('should round up (ceil)', () => {
    // 10 chars / 3.5 = 2.857 -> ceil = 3
    expect(estimateTokens('a'.repeat(10))).toBe(3);
    
    // 3 chars / 3.5 = 0.857 -> ceil = 1
    expect(estimateTokens('abc')).toBe(1);
  });

  it('should handle long text', () => {
    const longText = 'a'.repeat(10000);
    expect(estimateTokens(longText)).toBe(Math.ceil(10000 / 3.5));
  });

  it('should handle unicode characters', () => {
    // Each unicode char counts as 1 in length
    const text = 'açãoão';
    expect(estimateTokens(text)).toBe(Math.ceil(6 / 3.5));
  });
});

describe('enforceTokenLimit', () => {
  const createMessage = (content: string, role: 'user' | 'assistant' = 'user'): ChatMessage => ({
    role,
    content,
  });

  describe('basic behavior', () => {
    it('should return empty array for empty history', () => {
      const result = enforceTokenLimit([], 5000);
      expect(result).toEqual([]);
    });

    it('should return history unchanged when within limit', () => {
      const history: ChatMessage[] = [
        createMessage('Olá'),
        createMessage('Oi, como posso ajudar?'),
      ];
      
      const result = enforceTokenLimit(history, 5000);
      expect(result).toEqual(history);
    });

    it('should use default limit of 5000 when not specified', () => {
      const history: ChatMessage[] = [
        createMessage('a'.repeat(10000)), // ~2857 tokens + 5 = 2862
      ];
      
      // Default is 5000, so this should fit
      const result = enforceTokenLimit(history);
      expect(result).toHaveLength(1);
    });
  });

  describe('token limit enforcement', () => {
    it('should remove oldest messages when over limit', () => {
      const history: ChatMessage[] = [
        createMessage('a'.repeat(5000)), // ~1428 + 5 = 1433 tokens
        createMessage('b'.repeat(5000)), // ~1428 + 5 = 1433 tokens
        createMessage('c'.repeat(5000)), // ~1428 + 5 = 1433 tokens
        createMessage('d'.repeat(5000)), // ~1428 + 5 = 1433 tokens
      ];
      // Total: ~5732 tokens, over 5000 limit
      
      const result = enforceTokenLimit(history, 5000);
      
      // Should remove oldest messages until under limit
      expect(result.length).toBeLessThan(4);
      // Should preserve newest messages
      expect(result[result.length - 1].content).toBe('d'.repeat(5000));
    });

    it('should preserve order of remaining messages', () => {
      const history: ChatMessage[] = [
        createMessage('first'),
        createMessage('second'),
        createMessage('third'),
        createMessage('fourth'),
        createMessage('fifth'),
      ];
      
      // Make each message large enough that we need to remove some
      const largeHistory = history.map(m => ({
        ...m,
        content: m.content + 'x'.repeat(2000), // ~571 tokens each
      }));
      
      const result = enforceTokenLimit(largeHistory, 2000);
      
      // Should preserve chronological order of remaining
      for (let i = 1; i < result.length; i++) {
        const origIndex = largeHistory.findIndex(m => m.content === result[i].content);
        const prevOrigIndex = largeHistory.findIndex(m => m.content === result[i-1].content);
        expect(origIndex).toBeGreaterThan(prevOrigIndex);
      }
    });

    it('should handle limit of zero', () => {
      const history: ChatMessage[] = [
        createMessage('test'),
      ];
      
      const result = enforceTokenLimit(history, 0);
      expect(result).toEqual([]);
    });

    it('should handle single message larger than limit', () => {
      const history: ChatMessage[] = [
        createMessage('x'.repeat(20000)), // ~5714 tokens, over 5000 limit
      ];
      
      const result = enforceTokenLimit(history, 5000);
      // Current implementation removes messages until under limit
      // If single message exceeds limit, it will be removed
      expect(result).toEqual([]);
    });

    it('should remove all messages when none fit', () => {
      const history: ChatMessage[] = [
        createMessage('x'.repeat(10000)), // ~2857 tokens
        createMessage('y'.repeat(10000)), // ~2857 tokens
      ];
      
      const result = enforceTokenLimit(history, 100); // Very small limit
      expect(result).toEqual([]);
    });
  });

  describe('5 tokens per message overhead', () => {
    it('should include 5 tokens per message in calculation', () => {
      // 100 chars = 29 tokens, + 5 = 34 per message
      const history: ChatMessage[] = [
        createMessage('a'.repeat(100)), // 34 tokens
        createMessage('b'.repeat(100)), // 34 tokens
        createMessage('c'.repeat(100)), // 34 tokens
      ];
      // Total = 102 tokens
      
      const result = enforceTokenLimit(history, 100);
      // Should remove one message to get under 100
      expect(result).toHaveLength(2);
    });
  });

  describe('original array immutability', () => {
    it('should not modify the original history array', () => {
      const history: ChatMessage[] = [
        createMessage('first'),
        createMessage('second'),
        createMessage('third'),
      ];
      
      const originalLength = history.length;
      const originalFirst = history[0];
      
      enforceTokenLimit(history, 10); // Force removal
      
      expect(history.length).toBe(originalLength);
      expect(history[0]).toBe(originalFirst);
    });

    it('should return a new array', () => {
      const history: ChatMessage[] = [
        createMessage('first'),
        createMessage('second'),
      ];
      
      const result = enforceTokenLimit(history, 5000);
      expect(result).not.toBe(history);
    });
  });

  describe('conversation context preservation', () => {
    it('does not guarantee user/assistant pair preservation', () => {
      // This documents the current behavior - it removes oldest messages
      // regardless of role pairing
      const history: ChatMessage[] = [
        createMessage('user 1', 'user'),
        createMessage('assistant 1', 'assistant'),
        createMessage('user 2', 'user'),
        createMessage('assistant 2', 'assistant'),
        createMessage('user 3', 'user'),
      ];
      
      // Make messages large to force removal
      const largeHistory = history.map(m => ({
        ...m,
        content: m.content + 'x'.repeat(3000), // ~857 tokens each
      }));
      
      const result = enforceTokenLimit(largeHistory, 2000);
      
      // Current behavior: removes from start regardless of pairs
      // This may break conversation context - documented for awareness
      expect(result.length).toBeLessThan(5);
    });
  });

  describe('edge cases', () => {
    it('should handle messages with special characters', () => {
      const history: ChatMessage[] = [
        createMessage('🎉 Emoji test \n\t\r'),
        createMessage('Normal message'),
      ];
      
      const result = enforceTokenLimit(history, 5000);
      expect(result).toHaveLength(2);
    });

    it('should handle very large maxAllowedTokens', () => {
      const history: ChatMessage[] = [
        createMessage('small'),
      ];
      
      const result = enforceTokenLimit(history, Number.MAX_SAFE_INTEGER);
      expect(result).toHaveLength(1);
    });

    it('should handle negative maxAllowedTokens', () => {
      const history: ChatMessage[] = [
        createMessage('test'),
      ];
      
      const result = enforceTokenLimit(history, -100);
      expect(result).toEqual([]);
    });
  });
});