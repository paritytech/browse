/**
 * Recommendations of a project, shaped for the chart.
 *
 * The reads live in `BrowseSdk.listRecommendations`. This turns the flat list
 * into a cumulative daily series, which is what a growth chart needs and what
 * the chain cannot answer directly.
 */

import type { Recommendation } from '@parity/browse-sdk'

import { ensureBrowseSdk } from './chain'

/** One point on the chart: a day, and the running total at the end of it. */
export type RecommendationPoint = { at: number; total: number }

export type RecommendationSeries = {
  total: number
  points: RecommendationPoint[]
}

const DAY = 86_400_000

const startOfDay = (at: number): number => Math.floor(at / DAY) * DAY

/**
 * The cumulative recommendation series for a label.
 *
 * Every day between the first recommendation and today carries a point, so a
 * quiet stretch reads as a flat line rather than a missing gap.
 */
export async function readRecommendations(label: string): Promise<RecommendationSeries> {
  const sdk = await ensureBrowseSdk()
  const recommendations: Recommendation[] = await sdk.listRecommendations(label)
  if (recommendations.length === 0) return { total: 0, points: [] }

  const perDay = new Map<number, number>()
  for (const recommendation of recommendations) {
    const day = startOfDay(recommendation.at)
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
  }

  const first = startOfDay(recommendations[0]!.at)
  const last = startOfDay(Date.now())
  const points: RecommendationPoint[] = []
  let total = 0
  for (let day = first; day <= last; day += DAY) {
    total += perDay.get(day) ?? 0
    points.push({ at: day, total })
  }
  return { total: recommendations.length, points }
}
