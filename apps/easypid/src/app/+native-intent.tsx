import 'fast-text-encoding'

import { credentialDataHandlerOptions } from '@easypid/config/credentialDataHandlerOptions'
import { allowedRedirectBaseUrls, appScheme } from '@easypid/constants'
import { deeplinkSchemes } from '@package/app'
import { LogLevel, ParadymWalletSdkConsoleLogger, parseInvitationUrlSync } from '@paradym/wallet-sdk'
import * as Haptics from 'expo-haptics'
import { router } from 'expo-router'

// NOTE: previously we had this method async, but somehow this prevent the
// deeplink from working on a cold startup. We updated the invitation handler to
// be fully sync.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  const logger = new ParadymWalletSdkConsoleLogger(LogLevel.trace)

  logger.debug(`Handling deeplink for path ${path}.`, {
    initial,
  })

  const isRecognizedDeeplink = deeplinkSchemes.some((scheme) => path.startsWith(scheme))
  const hasEmbeddedOpenIdInvitation =
    path.includes('request_uri=') ||
    path.includes('request=') ||
    path.includes('credential_offer_uri=') ||
    path.includes('credential_offer=')

  try {
    // For the bdr mDL issuer we use authorized code flow, but they also
    // redirect to the ausweis app. From the ausweis app we are then redirected
    // back to the easypid wallet.
    const parsedPath = new URL(path)
    const credentialAuthorizationCode = parsedPath.searchParams.get('code')
    const credentialAuthorizationError = parsedPath.searchParams.get('error')
    const credentialAuthorizationErrorDescription = parsedPath.searchParams.get('error_description')
    const credentialAuthorizationState = parsedPath.searchParams.get('state')

    const isUniversalRedirect =
      allowedRedirectBaseUrls?.some((redirectBaseUrl) => {
        const parsedRedirectBaseUrl = new URL(redirectBaseUrl)
        return (
          parsedRedirectBaseUrl.host === parsedPath.host &&
          parsedRedirectBaseUrl.pathname === parsedPath.pathname &&
          parsedRedirectBaseUrl.host === parsedPath.host
        )
      }) ?? false

    const isDeeplinkRedirect = parsedPath.protocol === `${appScheme}:` && parsedPath.pathname === '/wallet/redirect'

    if ((isUniversalRedirect || isDeeplinkRedirect) && (credentialAuthorizationCode || credentialAuthorizationError)) {
      logger.debug(
        'Link is redirect after authorization code flow. Setting authorization result search params, but not routing to any screen',
        {
          credentialAuthorizationCode,
          credentialAuthorizationError,
          credentialAuthorizationErrorDescription,
          credentialAuthorizationState,
        }
      )

      router.setParams({
        ...(credentialAuthorizationCode ? { credentialAuthorizationCode } : undefined),
        ...(credentialAuthorizationError ? { credentialAuthorizationError } : undefined),
        ...(credentialAuthorizationErrorDescription ? { credentialAuthorizationErrorDescription } : undefined),
        ...(credentialAuthorizationState ? { credentialAuthorizationState } : undefined),
      })
      return null
    }

    if (!isRecognizedDeeplink && !hasEmbeddedOpenIdInvitation) {
      logger.debug(
        'Deeplink is not a recognized invitation link, routing to deeplink directly instead of parsing as invitation.'
      )
      return path
    }

    try {
      const invitationData = parseInvitationUrlSync(path)
      let redirectPath: string | undefined

      if (!credentialDataHandlerOptions.allowedInvitationTypes.includes(invitationData.type)) {
        logger.warn(`Invitation type ${invitationData.type} is not allowed. Routing to home screen`)
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        return '/'
      }

      if (invitationData.type === 'openid-credential-offer') {
        redirectPath = `/incomingDeeplink?kind=openid-credential-offer&uri=${encodeURIComponent(invitationData.data)}&source=deeplink`
      }
      if (invitationData.type === 'openid-authorization-request') {
        redirectPath = `/incomingDeeplink?kind=openid-authorization-request&uri=${encodeURIComponent(invitationData.data)}&source=deeplink`
      }
      if (invitationData.type === 'didcomm') {
        redirectPath = `/notifications/didcomm?invitationUrl=${encodeURIComponent(invitationData.data)}`
      }

      if (redirectPath) {
        logger.debug(`Redirecting to path ${redirectPath}`)
        return redirectPath
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      return '/'
    } catch (error) {
      logger.info('Deeplink is not a valid invitation. Routing to home screen', {
        error: error,
        message: (error as Error).message,
      })

      return '/'
    }
  } catch (_error) {
    return '/'
  }
}
