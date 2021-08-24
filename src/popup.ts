import { getStorage } from './storage'
import { cleanDomain } from './util'

// when popup is loaded, setup event listeners
document.addEventListener('DOMContentLoaded', () => {
  // setup listener for toggle
  const toggleSwitch: HTMLInputElement = document.querySelector(
    '#reflect-toggle'
  ) as HTMLInputElement
  toggleSwitch.addEventListener('change', toggleState, false)

  // get current state and set approriately
  getStorage().then((storage) => {
    // set toggle state to storage value
    toggleSwitch.checked = storage.isEnabled
    setupBlockListener(storage.blockedSites, storage.enableInvertedMode)
  })
})

// function to update background with current toggle state
function toggleState(e) {
  const port: chrome.runtime.Port = chrome.runtime.connect({
    name: 'toggleState',
  })

  port.postMessage({ state: e.target.checked })
  port.disconnect()
}

// return what current text of button should be
function getButtonText(url: string, blockedSites: string[], invertedMode: boolean): string {
  if (!invertedMode) {
    return blockedSites.includes(url) ? 'unblock page.' : 'block page.'
  } else {
    return blockedSites.includes(url) ? 'unallow page.' : 'allow page.'
  }
}

// setup listener for what block button should do
function setupBlockListener(blockedSites, invertedMode) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const urls: string[] = tabs.map((x) => x.url)
    const domain: string = cleanDomain(urls)

    document.getElementById('block').innerHTML = getButtonText(domain, blockedSites, invertedMode)

    // not on a page (probably new tab)
    if (domain === '') {
      document.getElementById('curDomain').textContent = 'none.'
      return
    }

    document.getElementById('curDomain').textContent = domain
    document.getElementById('block').addEventListener('click', () => {
      const port: chrome.runtime.Port = chrome.runtime.connect({
        name: 'blockFromPopup',
      })

      // toggle state text and update background script
      const buttonText: string = document.getElementById('block').innerHTML
      if (buttonText == 'block page.' || buttonText == 'allow page.') {
        port.postMessage({ unblock: false, siteURL: domain })
        document.getElementById('block').innerHTML = invertedMode ? 'unallow page.' : 'unblock page.'
      } else {
        port.postMessage({ unblock: true, siteURL: domain })
        document.getElementById('block').innerHTML = invertedMode ? 'allow page.' : 'block page.'
      }

      // cleanup connection
      port.disconnect()
    })
  })
}
