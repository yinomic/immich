import { searchManager } from '$lib/managers/search-manager.svelte';

describe('SearchManager', () => {
  beforeEach(() => {
    localStorage.clear();
    searchManager.reset();
  });

  it('defaults to metadata search', () => {
    expect(searchManager.filter.queryType).toBe('metadata');
  });

  it('remembers the selected query type', () => {
    searchManager.setQueryType('metadata');
    expect(searchManager.filter.queryType).toBe('metadata');

    searchManager.reset();
    expect(searchManager.filter.queryType).toBe('metadata');
  });

  it('overrides a previously stored query type', () => {
    localStorage.setItem('searchQueryType', 'metadata');
    searchManager.reset();

    searchManager.setQueryType('description');
    searchManager.reset();
    expect(searchManager.filter.queryType).toBe('description');
  });

  it('ignores an invalid stored query type', () => {
    localStorage.setItem('searchQueryType', 'invalid');
    searchManager.reset();
    expect(searchManager.filter.queryType).toBe('metadata');
  });
});
