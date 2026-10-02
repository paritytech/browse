import { describe, expect, test } from 'bun:test'

import { filterPublications } from './filter'

const list = [{ label: 'browse' }, { label: 'myapp' }, { label: 'mydomain' }]

describe('filterPublications', () => {
  test('keeps everything on an empty query', () => {
    expect(filterPublications(list, '')).toEqual(list)
    expect(filterPublications(list, '   ')).toEqual(list)
  })

  test('matches a substring of the label', () => {
    expect(filterPublications(list, 'my').map((p) => p.label)).toEqual(['myapp', 'mydomain'])
    expect(filterPublications(list, 'domain').map((p) => p.label)).toEqual(['mydomain'])
  })

  test('lowercases the query before matching', () => {
    expect(filterPublications(list, 'BROWSE').map((p) => p.label)).toEqual(['browse'])
  })

  test('returns nothing when no label matches', () => {
    expect(filterPublications(list, 'zzz')).toEqual([])
  })
})
