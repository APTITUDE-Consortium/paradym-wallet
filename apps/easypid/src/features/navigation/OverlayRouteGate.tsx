import { useHasFinishedOnboarding } from '@easypid/features/onboarding'
import { useParadym } from '@paradym/wallet-sdk'
import { Redirect, useGlobalSearchParams, usePathname } from 'expo-router'
import type { PropsWithChildren } from 'react'
import { encodeRedirectAfterUnlock } from './redirectAfterUnlock'

export function OverlayRouteGate({ children }: PropsWithChildren) {
  const paradym = useParadym()
  const pathname = usePathname()
  const params = useGlobalSearchParams() as Record<string, string | string[] | undefined>
  const [hasFinishedOnboarding] = useHasFinishedOnboarding()

  const shouldResetWallet =
    paradym.state !== 'not-configured' && paradym.state !== 'initializing' && !hasFinishedOnboarding
  const isWalletLocked = paradym.state === 'locked' || paradym.state === 'acquired-wallet-key'

  if (paradym.state === 'not-configured' || shouldResetWallet) {
    return <Redirect href={`/onboarding?reset=${shouldResetWallet}`} />
  }

  if (paradym.state === 'initializing') {
    return null
  }

  if (isWalletLocked) {
    const redirectAfterUnlock = encodeRedirectAfterUnlock(pathname, params, { requestAuthAfterUnlock: true })

    return <Redirect href={`/authenticateOverlay?redirectAfterUnlock=${redirectAfterUnlock}`} />
  }

  return children
}
