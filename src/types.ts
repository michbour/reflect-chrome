// types.ts defines interfaces for what valid storage looks like
// you shouldn't need to touch this unless you need to save something completely new to chrome storage!

export interface Intent {
  intent: string
  url: string
}

export interface Storage {
  // feature toggles
  isEnabled?: boolean
  enableBlobs?: boolean

  // lists
  blockedSites?: string[]
  intentList?: { [key: string]: Intent }
  whitelistedSites?: { [key: string]: string }

  // misc config
  numIntentEntries?: number
  whitelistTime?: number
}