import { describe, expect, test } from 'bun:test'

import { filterPublications } from './filter'
import type { Publication } from './publisher'

const list: Publication[] = [
  { label: 'browse', labelhash: '0x01', timestamp: 1 },
  { label: 'myapp', labelhash: '0x02', timestamp: 2 },
  { label: 'mydomain', labelhash: '0x03', timestamp: 3 }
]

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
