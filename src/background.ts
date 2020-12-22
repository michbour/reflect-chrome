import * as nn from './nn'
import { addMinutes, cleanDomain } from './util'
import { getStorage, setStorage } from './storage'
import setupContextMenu from './context_menus'
import { Intent } from './types'

// On install script
chrome.runtime.onInstalled.addListener((details) => {
  // on first time install
  if (details.reason === 'install') {
    chrome.tabs.create({
      // redir to onboarding url
      url: 'http://getreflect.app/onboarding',
      active: true,
    })

    firstTimeSetup()
  }

  // on version update
  if (details.reason === 'update') {
    turnFilteringOn()

    chrome.tabs.create({
      // redir to latest release patch notes
      url: 'http://getreflect.app/latest',
      active: true,
    })

    const thisVersion: string = chrome.runtime.getManifest().version
    console.log(`Updated from ${details.previousVersion} to ${thisVersion}!`)
  }

  // set uninstall url
  chrome.runtime.setUninstallURL('http://getreflect.app/uninstall')
})

function firstTimeSetup(): void {
  // defualt to on
  turnFilteringOn()

  // set whitelist
  const whitelist: { [key: string]: Date } = {}
  const intentList: { [key: string]: Intent } = {}

  setStorage({
    whitelistedSites: whitelist,
    intentList: intentList,
    whitelistTime: 5,
    numIntentEntries: 20,
    enableBlobs: true,
  }).then(() => {
    console.log('Default values have been set.')
  })

  addDefaultFilters()

  // set default badge background colour
  chrome.browserAction.setBadgeBackgroundColor({
    color: '#576ca8',
  })
}

// default list of blocked sites
function addDefaultFilters(): void {
  const blockedSites: string[] = ['facebook.com', 'twitter.com', 'instagram.com', 'youtube.com']
  chrome.storage.sync.set({ blockedSites: blockedSites }, () => {
    console.log('Default blocked sites have been loaded.')
  })
}

// On Chrome startup, setup extension icons
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.sync.get(null, (storage) => {
    let icon: string = 'res/icon.png'
    if (storage.isEnabled) {
      icon = 'res/on.png'
    } else if (!storage.isEnabled) {
      icon = 'res/off.png'
    }

    chrome.browserAction.setIcon({ path: { '16': icon } })
  })
})

// Catch menu clicks (page context and browser action context)
chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case 'baFilterListMenu':
      chrome.runtime.openOptionsPage()
      break
    case 'baAddSiteToFilterList':
    case 'pgAddSiteToFilterList':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const urls: string[] = tabs.map((x) => x.url)
        addUrlToBlockedSites(urls[0])
      })
      break
    case 'baAddDomainToFilterList':
    case 'pgAddDomainToFilterList':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const urls: string[] = tabs.map((x) => x.url)
        const domain: string = cleanDomain(urls)
        addUrlToBlockedSites(domain)
      })
      break
  }
})

// load context menus
setupContextMenu()

// Load ML model stuff
const model: nn.IntentClassifier = new nn.IntentClassifier('acc85.95')

// Listen for new runtime connections
chrome.runtime.onConnect.addListener((port) => {
  // check comm channel
  switch (port.name) {
    // listens for messages from content scripts
    case 'intentStatus': {
      port.onMessage.addListener(async (msg) => {
        // extract intent and url from message
        const intent: string = msg.intent

        // get whitelist period
        chrome.storage.sync.get(null, async (storage) => {
          const WHITELIST_PERIOD: number = storage.whitelistTime

          // check if too short
          const words: string[] = intent.split(' ')

          if (words.length <= 3) {
            // send status to tab
            port.postMessage({ status: 'too_short' })
          } else {
            // send to nlp model for prediction
            const valid: boolean = await model.predict(intent)

            if (valid) {
              // add whitelist period for site
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const urls: string[] = tabs.map((x) => x.url)
                const domain: string = cleanDomain(urls)
                addUrlToWhitelistedSites(domain, WHITELIST_PERIOD)
              })

              // send status to tab
              port.postMessage({ status: 'ok' })
              console.log(`Success! Redirecting`)
            } else {
              // send status to tab
              port.postMessage({ status: 'invalid' })
              console.log('Failed. Remaining on page.')
            }
          }
        })
      })
    }

    // listens for messages from popup
    case 'toggleState': {
      port.onMessage.addListener((msg) => {
        const on: boolean = msg.state
        if (on) {
          turnFilteringOn()
        } else if (on === false) {
          turnFilteringOff()
        }
      })
    }

    // listens for block from popup
    case 'blockFromPopup': {
      port.onMessage.addListener((msg) => {
        const url: string = msg.siteURL
        const unblock: boolean = msg.unblock
        if (url !== undefined && url !== '' && unblock !== undefined) {
          if (unblock) {
            removeUrlFromblockedSites(url)
          } else if (!unblock) {
            addUrlToBlockedSites(url)
          }
          reloadActive()
        }
      })
    }
  }
})

// push current site to storage
function addUrlToBlockedSites(url: string): void {
  chrome.storage.sync.get(null, (storage) => {
    // only add if not in list
    if (!storage.blockedSites.includes(url)) {
      storage.blockedSites.push(url) // urls.hostname
      chrome.storage.sync.set({ blockedSites: storage.blockedSites }, () => {
        console.log(`${url} added to blocked sites`)
      })
    }
  })
}

function removeUrlFromblockedSites(url: string): void {
  console.log(`trying to remove ${url}`)
  chrome.storage.sync.get(null, (storage) => {
    let blockedSites: string[] = storage.blockedSites

    // remove url from blockedSites
    blockedSites = blockedSites.filter((e) => e !== url)

    // sync with chrome storage
    chrome.storage.sync.set({ blockedSites: blockedSites }, () => {
      console.log(`removed ${url} from blocked sites`)
    })
  })
}

// push current site to whitelist with time to whitelist
function addUrlToWhitelistedSites(url: string, minutes: number): void {
  chrome.storage.sync.get(null, (storage) => {
    let whitelistedSites: { [key: string]: string } = storage.whitelistedSites

    let expiry: Date = addMinutes(new Date(), minutes)

    whitelistedSites[url] = expiry.toJSON()

    chrome.storage.sync.set({ whitelistedSites: whitelistedSites }, () => {
      console.log(`${url} added to whitelisted sites`)
    })
  })
}

var badgeUpdateCounter: number = window.setInterval(badgeCountDown, 1000)

function cleanupBadge(): void {
  chrome.browserAction.setBadgeText({
    text: '',
  })
}

function badgeCountDown(): void {
  // get current active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const urls: string[] = tabs.map((x) => x.url)
    const currentURL: string = urls[0]

    // check if currently on a page
    if (currentURL != undefined) {
      // clean url prefix stuff
      const matched: RegExpMatchArray | null = currentURL.match(/^[\w]+:\/{2}([\w\.:-]+)/)
      if (matched != null) {
        // strip url
        const strippedURL: string = matched[1].replace('www.', '')

        // get whitelisted sites
        chrome.storage.sync.get(null, (storage) => {
          const whitelistedSites: { [key: string]: Date } = storage.whitelistedSites

          if (whitelistedSites.hasOwnProperty(strippedURL)) {
            const expiry: Date = new Date(whitelistedSites[strippedURL])
            const currentDate: Date = new Date()

            const timeDifference: number = expiry.getTime() - currentDate.getTime()

            setBadge(timeDifference)
          } else {
            cleanupBadge()
          }
        })
      }
    } else {
      cleanupBadge()
    }
  })
}

function setBadge(time: number) {
  time = Math.round(time / 1000)
  if (time <= 0) {
    cleanupBadge()
  } else {
    if (time > 60) {
      const min: number = Math.round(time / 60)
      chrome.browserAction.setBadgeText({
        text: min.toString() + 'm',
      })
    } else {
      chrome.browserAction.setBadgeText({
        text: time.toString() + 's',
      })
    }
  }
}

function turnFilteringOff(): void {
  chrome.storage.sync.set({ isEnabled: false }, () => {
    // stop checking for badge updates
    window.clearInterval(badgeUpdateCounter)
    cleanupBadge()

    chrome.browserAction.setIcon({ path: 'res/off.png' }, () => {
      console.log('Filtering disabled')
    })
    reloadActive()
  })
}

function turnFilteringOn(): void {
  chrome.storage.sync.set({ isEnabled: true }, () => {
    // start badge update counter
    badgeUpdateCounter = window.setInterval(badgeCountDown, 1000)

    chrome.browserAction.setIcon({ path: 'res/on.png' }, () => {
      console.log('Filtering enabled.')
    })
    reloadActive()
  })
}

function reloadActive(): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.reload(tabs[0].id)
  })
}
