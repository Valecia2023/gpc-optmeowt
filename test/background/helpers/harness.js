import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { launch } from 'puppeteer'
import { spawnSync } from 'child_process'

import backgroundWait from '../helpers/backgroundWait.js'


const DATA_DIR_PREFIX = 'ddg-temp-'

const setup = async (ops) => {
    ops = ops || {}

    const loadExtension = ops.loadExtension !== false
    const tmpDirPrefix = join(tmpdir(), DATA_DIR_PREFIX)
    const dataDir = mkdtempSync(tmpDirPrefix)
    /** @type {import('puppeteer').PuppeteerLaunchOptions} */
    const puppeteerOps = {
        headless: 'chrome'
    }
    const args = [
        `--user-data-dir=${dataDir}`
    ]

    const manifestVersion = getManifestVersion()

    if (loadExtension) {
        let extensionPath = 'build/chrome/dev'
        if (manifestVersion === 3) {
            extensionPath = extensionPath.replace('chrome', 'chrome-mv3')
        }
        args.push('--disable-extensions-except=' + extensionPath)
        args.push('--load-extension=' + extensionPath)
    }

    // github actions
    if (process.env.CI) {
        args.push('--no-sandbox')
    }

    puppeteerOps.args = args
    const browser = await launch(puppeteerOps)

    let bgPage
    const requests = []

    if (loadExtension) {
        // Grab a handle on the background page for the extension.
        try {
            const backgroundPageTarget = await browser.waitForTarget(
                target => (
                    target.type() === 'background_page' ||
                    target.type() === 'service_worker'
                ),
                { timeout: 4000 }
            )
            bgPage = backgroundPageTarget.type() === 'background_page'
                ? await backgroundPageTarget.page()
                : await backgroundPageTarget.worker()
        } catch (e) {
            throw new Error(`Couldn't find background page. ${e}`)
        }

        if (!bgPage) {
            throw new Error('Couldn\'t find background page.')
        }

        // Set a flag to mark this as an integration test session.
        await backgroundWait.forFunction(
            bgPage, async () => globalThis?.dbg?.browserWrapper
        )
        await bgPage.evaluate(
            () => globalThis.dbg.browserWrapper
                .setToSessionStorage('integrationTest', true)
        )

        bgPage.on('request', (req) => { requests.push(req.url()) })
    }

    async function teardown () {
        if (process.env.KEEP_OPEN) {
            return new Promise((resolve) => {
                browser.on('disconnected', async () => {
                    await teardownInternal()
                    resolve(undefined)
                })
            })
        } else {
            await teardownInternal()
        }
    }

    async function teardownInternal () {
        await browser.close()

        // necessary so e.g. local storage
        // doesn't carry over between test runs
        spawnSync('rm', ['-rf', dataDir])
    }

    return { browser, bgPage, requests, teardown }
}

function getManifestVersion () {
    return process.env.npm_lifecycle_event === 'test-int-mv3' ? 3 : 2
}

export default {
    setup,
    getManifestVersion
}