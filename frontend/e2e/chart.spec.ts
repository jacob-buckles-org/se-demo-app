import { expect, test } from '@playwright/test'

// The chart only mounts once the metrics fetch resolves and the hourly
// rollup has run, so this budget has to cover fetch + aggregate + first
// paint. Tuned 2026-09-08 after 21 consecutive greens at 400ms on
// blacksmith-2vcpu — the contended firefox/webkit tail no longer cleared
// 400ms, so the budget sat entirely above the race. 250ms + a heavier
// mock payload puts the assertion back inside the contention window
// (see DEMO_MECHANICS.md §1.1).
const CHART_RENDER_BUDGET_MS = 250

// Dense "last 24 hours" payload — more series means more rollup + Recharts
// work under the same 2 vCPU / 3-browser contention.
const services = [
  'ingest-api',
  'query-api',
  'billing',
  'alerting',
  'exporter',
  'auth-gateway',
  'stream-processor',
  'warehouse-sync',
  'anomaly-detect',
  'quota-enforcer',
  'audit-trail',
  'notify-dispatch',
]
const dayOfMetrics = services.flatMap((service, s) =>
  Array.from({ length: 24 }, (_, hour) => ({
    timestamp: `2026-07-15T${String(hour).padStart(2, '0')}:00:00Z`,
    service,
    requests: 30_000 + hour * 911 + s * 4_200,
    errors: hour * 7 + s,
    p95LatencyMs: 85 + hour + s * 3,
  })),
)

test.describe('request volume chart', () => {
  // No retries here. These are render-timing assertions, and retrying them
  // just papers over the regression they exist to catch: a retry runs against
  // a warm browser and a warm bundle cache, so it almost always passes and
  // the signal is lost. Fail loudly instead.
  test.describe.configure({ retries: 0 })

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/metrics', (route) => route.fulfill({ json: dayOfMetrics }))
  })

  test('plots request and error series for the last 24h', async ({ page }) => {
    await page.goto('/')

    const chart = page.getByTestId('usage-chart')
    await expect(chart).toBeVisible({ timeout: CHART_RENDER_BUDGET_MS })

    // Recharts renders one <path class="recharts-area-area"> per <Area>:
    // one for requests, one for errors.
    await expect(chart.locator('path.recharts-area-area')).toHaveCount(2)
  })

  test('labels the chart with its reporting window', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('usage-chart')).toContainText('Request volume by hour')
  })
})
