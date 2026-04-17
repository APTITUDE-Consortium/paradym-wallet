import { TypedArrayEncoder } from '@credo-ts/core'

export const requestAuthAfterUnlockParam = 'requestAuthAfterUnlock'
export const requestOpenedWhileUnlockedParam = 'requestOpenedWhileUnlocked'

type RedirectParams = Record<string, string | string[] | undefined>

export const encodeRedirectAfterUnlock = (
  pathname: string,
  params: RedirectParams,
  options?: { requestAuthAfterUnlock?: boolean }
) => {
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      searchParams.set(key, value)
    }
  }

  if (options?.requestAuthAfterUnlock && !didOpenRequestWhileUnlocked(params[requestOpenedWhileUnlockedParam])) {
    searchParams.set(requestAuthAfterUnlockParam, '1')
  }

  const suffix = searchParams.toString()
  return TypedArrayEncoder.toBase64URL(TypedArrayEncoder.fromString(`${pathname}${suffix ? `?${suffix}` : ''}`))
}

export const didUnlockForRequest = (value?: string | string[]) => value === '1'
export const didOpenRequestWhileUnlocked = (value?: string | string[]) => value === '1'
