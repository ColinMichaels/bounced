import { expect, test, type BrowserContext, type Page } from '@playwright/test'

interface HostHarness {
  getSnapshot: () => {
    phase: string
    selectedLevel: number
    note: string
    activeWindowIds: string[]
    activeTarget: { kind: 'bridge' | 'goal'; windowId: string; label: string } | null
    completedBridgeWindowIds: string[]
  }
  getOpenWindowIds: () => string[]
  getSummaryOpen: () => boolean
  getAudioState: () => string
  forceLevelComplete: () => boolean
  attemptActiveTargetHit: () => boolean
  coverActiveTarget: () => boolean
  closeWindow: (id: string) => boolean
  setFrontWindow: (id: string | null) => void
}

async function gotoHost(page: Page): Promise<void> {
  await page.goto('/?test=1')
  await expect(page.getByRole('heading', { name: 'BOUNCED' })).toBeVisible()
}

async function startGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start Game' }).click()
  await expect
    .poll(() => getOpenWindowCount(page))
    .toBe(3)
  await expect.poll(() => getPhase(page)).toBe('running')
}

async function openSummary(page: Page): Promise<Page> {
  const context = page.context()
  await expect.poll(() => getPhase(page)).toBe('running')
  const summaryPromise = context.waitForEvent('page')
  const opened = await forceLevelComplete(page)
  expect(opened).toBe(true)
  const summary = await summaryPromise
  await summary.waitForLoadState('domcontentloaded')
  await expect(summary.locator('#summary-title')).toBeVisible()
  return summary
}

async function getOpenWindowCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    return harness.getOpenWindowIds().length
  })
}

async function getPhase(page: Page): Promise<string> {
  return page.evaluate(() => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    return harness.getSnapshot().phase
  })
}

async function getSelectedLevel(page: Page): Promise<number> {
  return page.evaluate(() => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    return harness.getSnapshot().selectedLevel
  })
}

async function getSnapshot(page: Page): Promise<ReturnType<HostHarness['getSnapshot']>> {
  return page.evaluate(() => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    return harness.getSnapshot()
  })
}

async function forceLevelComplete(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    return harness.forceLevelComplete()
  })
}

async function attemptActiveTargetHit(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    return harness.attemptActiveTargetHit()
  })
}

async function coverActiveTarget(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    return harness.coverActiveTarget()
  })
}

async function setFrontWindow(page: Page, windowId: string | null): Promise<void> {
  await page.evaluate((id) => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    harness.setFrontWindow(id)
  }, windowId)
}

async function closeFirstWindow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    const [firstId] = harness.getOpenWindowIds()
    return firstId ? harness.closeWindow(firstId) : false
  })
}

async function getAudioState(page: Page): Promise<string> {
  return page.evaluate(() => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    return harness.getAudioState()
  })
}

function popupPages(context: BrowserContext, host: Page): Page[] {
  return context.pages().filter((page) => page !== host)
}

test('spawns popup rooms and aborts on room close', async ({ browser }) => {
  const context = await browser.newContext()
  const host = await context.newPage()

  await gotoHost(host)
  await startGame(host)
  await expect.poll(() => popupPages(context, host).length).toBe(3)

  const closed = await closeFirstWindow(host)
  expect(closed).toBe(true)

  await expect.poll(() => getOpenWindowCount(host)).toBe(0)
  await expect.poll(() => host.locator('#status-text').textContent()).toContain('was closed during play')

  await context.close()
})

test('summary window can start the next level', async ({ browser }) => {
  const context = await browser.newContext()
  const host = await context.newPage()

  await gotoHost(host)
  await startGame(host)

  const summary = await openSummary(host)
  await expect(summary.locator('#summary-title')).toContainText('Level 1 Complete')

  await summary.getByRole('button', { name: /Start Level 2/i }).click()

  await expect.poll(() => getSelectedLevel(host)).toBe(2)
  await expect.poll(() => getPhase(host)).not.toBe('summary')
  await expect.poll(() => getAudioState(host)).toBe('running')
  await expect.poll(async () => (await getOpenWindowCount(host)) >= 3).toBe(true)
  await expect.poll(() => summary.isClosed()).toBe(true)

  await context.close()
})

test('summary window can replay the cleared level or return to the lobby', async ({ browser }) => {
  const context = await browser.newContext()
  const host = await context.newPage()

  await gotoHost(host)
  await startGame(host)

  let summary = await openSummary(host)
  await summary.getByRole('button', { name: /Replay Level 1/i }).click()

  await expect.poll(() => getSelectedLevel(host)).toBe(1)
  await expect.poll(() => getAudioState(host)).toBe('running')
  await expect.poll(() => summary.isClosed()).toBe(true)
  await expect.poll(async () => (await getOpenWindowCount(host)) >= 3).toBe(true)

  summary = await openSummary(host)
  await summary.getByRole('button', { name: 'Return To Lobby' }).click()

  await expect.poll(() => getPhase(host)).toBe('idle')
  await expect.poll(() => getOpenWindowCount(host)).toBe(0)
  await expect.poll(() => summary.isClosed()).toBe(true)

  await context.close()
})

test('hidden relay and goal objectives do not score while covered in overlap stacks', async ({ browser }) => {
  const context = await browser.newContext()
  const host = await context.newPage()

  await gotoHost(host)
  await startGame(host)

  let snapshot = await getSnapshot(host)
  expect(snapshot.activeTarget?.kind).toBe('bridge')
  const bridgeTargetWindowId = snapshot.activeTarget?.windowId ?? null
  const bridgeCoverWindowId = snapshot.activeWindowIds.find((id) => id !== bridgeTargetWindowId) ?? null
  const bridgeTopWindowId = snapshot.activeWindowIds.find((id) =>
    id !== bridgeTargetWindowId && id !== bridgeCoverWindowId,
  ) ?? null

  expect(await coverActiveTarget(host)).toBe(true)
  if (bridgeTopWindowId) {
    await setFrontWindow(host, bridgeTopWindowId)
  }
  expect(await attemptActiveTargetHit(host)).toBe(false)
  await expect.poll(async () => (await getSnapshot(host)).completedBridgeWindowIds.length).toBe(0)
  await expect.poll(() => host.locator('#status-text').textContent()).toContain('masked')

  snapshot = await getSnapshot(host)
  await setFrontWindow(host, snapshot.activeTarget?.windowId ?? null)
  expect(await attemptActiveTargetHit(host)).toBe(true)
  await expect.poll(async () => (await getSnapshot(host)).completedBridgeWindowIds.length).toBe(1)

  snapshot = await getSnapshot(host)
  expect(snapshot.activeTarget?.kind).toBe('goal')
  const goalTargetWindowId = snapshot.activeTarget?.windowId ?? null
  const goalCoverWindowId = snapshot.activeWindowIds.find((id) => id !== goalTargetWindowId) ?? null
  const goalTopWindowId = snapshot.activeWindowIds.find((id) =>
    id !== goalTargetWindowId && id !== goalCoverWindowId,
  ) ?? null
  expect(await coverActiveTarget(host)).toBe(true)
  if (goalTopWindowId) {
    await setFrontWindow(host, goalTopWindowId)
  }
  expect(await attemptActiveTargetHit(host)).toBe(false)
  await expect.poll(() => getPhase(host)).toBe('running')
  await expect.poll(() => host.locator('#status-text').textContent()).toContain('masked')

  snapshot = await getSnapshot(host)
  await setFrontWindow(host, snapshot.activeTarget?.windowId ?? null)
  expect(await attemptActiveTargetHit(host)).toBe(true)
  await expect.poll(() => getPhase(host)).toBe('summary')
  await expect.poll(() => host.evaluate(() => !!window.__BOUNCED_TEST__?.getSummaryOpen())).toBe(true)

  await context.close()
})
