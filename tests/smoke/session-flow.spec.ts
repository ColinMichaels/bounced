import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import type { GameSnapshot } from '../../src/shared/types'

interface HostHarness {
  getSnapshot: () => GameSnapshot
  getOpenWindowIds: () => string[]
  getSummaryOpen: () => boolean
  getAudioState: () => string
  forceLevelComplete: () => boolean
  attemptActiveTargetHit: () => boolean
  coverActiveTarget: () => boolean
  resolveContainingWindowId: (x: number, y: number, preferredWindowId: string | null) => string | null
  closeWindow: (id: string) => boolean
  setFrontWindow: (id: string | null) => void
  pauseForDeckFocus: () => void
  simulateFocusReturn: () => void
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

async function getWarningText(page: Page): Promise<string> {
  return (await page.locator('#host-warning').textContent()) ?? ''
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

async function resolveContainingWindowId(
  page: Page,
  x: number,
  y: number,
  preferredWindowId: string | null,
): Promise<string | null> {
  return page.evaluate(({ x: pointX, y: pointY, preferredWindowId: preferredId }) => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    return harness.resolveContainingWindowId(pointX, pointY, preferredId)
  }, { x, y, preferredWindowId })
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

async function pauseForDeckFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    harness.pauseForDeckFocus()
  })
}

async function simulateFocusReturn(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as Window & { __BOUNCED_TEST__?: HostHarness }).__BOUNCED_TEST__
    if (!harness) {
      throw new Error('Missing host test harness.')
    }

    harness.simulateFocusReturn()
  })
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

test('clicking a room recalls the cluster and resumes after deck focus pause', async ({ browser }) => {
  const context = await browser.newContext()
  const host = await context.newPage()

  await gotoHost(host)
  await startGame(host)

  const [room] = popupPages(context, host)
  expect(room).toBeTruthy()

  await host.bringToFront()
  await host.keyboard.press('Escape')
  await expect.poll(() => getPhase(host)).toBe('paused')
  await expect.poll(() => getWarningText(host)).toContain('Session paused while the control deck is focused')

  await room!.bringToFront()
  await room!.locator('#canvas-frame').click({ position: { x: 24, y: 24 } })

  await expect.poll(() => getPhase(host)).toBe('running')
  await expect.poll(() => getWarningText(host)).not.toContain('Session paused while the control deck is focused')
  await expect.poll(async () => popupPages(context, host).length).toBe(3)

  await context.close()
})

test('hud rooms button recalls the live window cluster', async ({ browser }) => {
  const context = await browser.newContext()
  const host = await context.newPage()

  await gotoHost(host)
  await startGame(host)

  await host.bringToFront()
  await simulateFocusReturn(host)
  await expect.poll(() => getPhase(host)).toBe('running')
  await expect(host.locator('#hud-recall-button')).toBeVisible()

  await host.locator('#hud-recall-button').click()

  await expect.poll(() => getPhase(host)).toBe('running')
  await expect.poll(async () => popupPages(context, host).length).toBe(3)

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

test('summary popup keeps its primary actions visible without scrolling', async ({ browser }) => {
  const context = await browser.newContext()
  const host = await context.newPage()

  await gotoHost(host)
  await startGame(host)

  const summary = await openSummary(host)

  await expect(summary.getByRole('button', { name: /Start Level 2/i })).toBeVisible()
  await expect(summary.getByRole('button', { name: /Start Level 2/i })).toBeInViewport()
  await expect(summary.getByRole('button', { name: /Replay Level 1/i })).toBeInViewport()
  await expect(summary.getByRole('button', { name: 'Return To Lobby' })).toBeInViewport()

  await context.close()
})

test('summary upgrades can power the in-game HUD utilities on the next level', async ({ browser }) => {
  const context = await browser.newContext()
  const host = await context.newPage()

  await gotoHost(host)
  await startGame(host)

  const summary = await openSummary(host)
  const beforePurchase = await getSnapshot(host)

  expect(beforePurchase.upgradeCredits).toBeGreaterThanOrEqual(2)
  expect(beforePurchase.runUpgradeLevels.reserve_cells).toBe(0)

  await summary.locator('button[data-upgrade="reserve_cells"]').click()

  await expect.poll(async () => (await getSnapshot(host)).runUpgradeLevels.reserve_cells).toBe(1)
  await expect.poll(async () => (await getSnapshot(host)).upgradeCredits).toBe(beforePurchase.upgradeCredits - 2)

  await summary.getByRole('button', { name: /Start Level 2/i }).click()

  await expect.poll(() => getSelectedLevel(host)).toBe(2)
  await expect.poll(async () => popupPages(context, host).length).toBe(3)
  await popupPages(context, host)[0]!.bringToFront()
  await expect(host.locator('#hud-utility-button')).toBeVisible()
  await simulateFocusReturn(host)
  await host.waitForTimeout(180)
  await expect.poll(() => getPhase(host)).toBe('running')
  await expect(host.locator('#hud-utility-button')).toBeEnabled()
  await host.locator('#hud-utility-button').click()
  await host.waitForTimeout(180)
  await expect.poll(() => getPhase(host)).toBe('running')
  await expect.poll(async () => (await getSnapshot(host)).utilityCharges).toBeGreaterThanOrEqual(1)
  await expect.poll(async () => (await getSnapshot(host)).activeUtility?.kind).toBe('bridge_pulse')

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
  await pauseForDeckFocus(host)
  await expect.poll(() => getPhase(host)).toBe('paused')

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
  await expect.poll(() => getPhase(host)).toBe('paused')
  await expect.poll(() => host.locator('#status-text').textContent()).toContain('masked')

  snapshot = await getSnapshot(host)
  await setFrontWindow(host, snapshot.activeTarget?.windowId ?? null)
  expect(await attemptActiveTargetHit(host)).toBe(true)
  await expect.poll(() => getPhase(host)).toBe('summary')
  await expect.poll(() => host.evaluate(() => !!window.__BOUNCED_TEST__?.getSummaryOpen())).toBe(true)

  await context.close()
})

test('stacked overlap ownership follows the front room instead of the xray room beneath it', async ({ browser }) => {
  const context = await browser.newContext()
  const host = await context.newPage()

  await gotoHost(host)
  await startGame(host)
  await pauseForDeckFocus(host)
  await expect.poll(() => getPhase(host)).toBe('paused')

  let snapshot = await getSnapshot(host)
  const targetWindowId = snapshot.activeTarget?.windowId ?? null
  const coverWindowId = snapshot.activeWindowIds.find((id) => id !== targetWindowId) ?? null

  expect(targetWindowId).toBeTruthy()
  expect(coverWindowId).toBeTruthy()
  expect(await coverActiveTarget(host)).toBe(true)

  snapshot = await getSnapshot(host)
  const overlapTarget = snapshot.activeTarget
  expect(overlapTarget).toBeTruthy()

  await setFrontWindow(host, coverWindowId)
  await expect
    .poll(() => resolveContainingWindowId(host, overlapTarget!.x, overlapTarget!.y, targetWindowId))
    .toBe(coverWindowId)

  await setFrontWindow(host, targetWindowId)
  await expect
    .poll(() => resolveContainingWindowId(host, overlapTarget!.x, overlapTarget!.y, coverWindowId))
    .toBe(targetWindowId)

  await context.close()
})
