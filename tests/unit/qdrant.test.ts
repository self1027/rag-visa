import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { MockQdrantClient, mockGetCollections, mockCreateCollection } = vi.hoisted(() => {
  const mockGetCollections = vi.fn();
  const mockCreateCollection = vi.fn();
  class MockQdrantClient {
    getCollections = mockGetCollections;
    createCollection = mockCreateCollection;
  }
  return { MockQdrantClient, mockGetCollections, mockCreateCollection };
});

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: MockQdrantClient,
}));

vi.mock('dotenv/config', () => ({}));

import { setupQdrantCollection, qdrantClient, COLLECTION_NAME } from '../../src/config/qdrant.js';

describe('setupQdrantCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCollections.mockReset();
    mockCreateCollection.mockReset();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should create collection when it does not exist', async () => {
    mockGetCollections.mockResolvedValue({ collections: [] });
    mockCreateCollection.mockResolvedValue({});
    
    await setupQdrantCollection();
    
    expect(mockGetCollections).toHaveBeenCalled();
    expect(mockCreateCollection).toHaveBeenCalledWith('legislacao_visa', {
      vectors: {
        size: 1024,
        distance: 'Cosine',
      },
    });
  });

  it('should not recreate collection when it already exists', async () => {
    mockGetCollections.mockResolvedValue({
      collections: [{ name: 'legislacao_visa' }],
    });
    
    await setupQdrantCollection();
    
    expect(mockGetCollections).toHaveBeenCalled();
    expect(mockCreateCollection).not.toHaveBeenCalled();
  });

  it('should check for correct collection name', async () => {
    mockGetCollections.mockResolvedValue({
      collections: [
        { name: 'other_collection' },
        { name: 'another_one' },
      ],
    });
    mockCreateCollection.mockResolvedValue({});
    
    await setupQdrantCollection();
    
    expect(mockCreateCollection).toHaveBeenCalledWith('legislacao_visa', expect.any(Object));
  });

  it('should use correct vector configuration', async () => {
    mockGetCollections.mockResolvedValue({ collections: [] });
    mockCreateCollection.mockResolvedValue({});
    
    await setupQdrantCollection();
    
    const createCall = mockCreateCollection.mock.calls[0];
    expect(createCall[1]).toEqual({
      vectors: {
        size: 1024,
        distance: 'Cosine',
      },
    });
  });

  it('should propagate error when getCollections fails', async () => {
    mockGetCollections.mockRejectedValue(new Error('Qdrant connection failed'));
    
    await expect(setupQdrantCollection()).rejects.toThrow('Qdrant connection failed');
  });

  it('should propagate error when createCollection fails', async () => {
    mockGetCollections.mockResolvedValue({ collections: [] });
    mockCreateCollection.mockRejectedValue(new Error('Failed to create collection'));
    
    await expect(setupQdrantCollection()).rejects.toThrow('Failed to create collection');
  });

  it('should throw after failed setup', async () => {
    mockGetCollections.mockResolvedValue({ collections: [] });
    mockCreateCollection.mockRejectedValue(new Error('Creation failed'));
    
    await expect(setupQdrantCollection()).rejects.toThrow('Creation failed');
  });
});

describe('Qdrant client configuration', () => {
  it('should export qdrantClient instance', () => {
    expect(qdrantClient).toBeDefined();
    expect(typeof qdrantClient.getCollections).toBe('function');
    expect(typeof qdrantClient.createCollection).toBe('function');
  });

  it('should export COLLECTION_NAME constant', () => {
    expect(COLLECTION_NAME).toBe('legislacao_visa');
  });
});