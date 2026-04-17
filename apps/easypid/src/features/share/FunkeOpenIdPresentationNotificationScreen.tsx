import { useDevelopmentMode, useOverAskingAi } from '@easypid/hooks'
import { formatPredicate } from '@easypid/utils/formatePredicate'
import { useLingui } from '@lingui/react/macro'
import { commonMessages } from '@package/translations'
import { useToastController } from '@package/ui'
import type {
  CredentialsForProofRequest,
  FormattedSubmissionEntrySatisfied,
  ResolveCredentialRequestStage,
} from '@paradym/wallet-sdk'
import {
  type FormattedTransactionData,
  getDisclosedAttributeNamesForDisplay,
  getFormattedTransactionData,
  ParadymWalletAuthenticationInvalidPinError,
  ParadymWalletBiometricAuthenticationCancelledError,
  useParadym,
} from '@paradym/wallet-sdk'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Platform } from 'react-native'
import {
  getWalletServiceProviderPin,
  setWalletServiceProviderPinFromString,
} from '../../crypto/WalletServiceProviderClient'
import { useExitWalletFlow } from '../../hooks/useExitWalletFlow'
import { useShouldUsePinForSubmission } from '../../hooks/useShouldUsePinForPresentation'
import {
  didOpenRequestWhileUnlocked,
  didUnlockForRequest,
  requestAuthAfterUnlockParam,
  requestOpenedWhileUnlockedParam,
} from '../navigation/redirectAfterUnlock'
import type { SelectedCredentialsMap } from './components/CredentialSelectionSection'
import { FunkePresentationNotificationScreen } from './FunkePresentationNotificationScreen'

export type OpenIdPresentationNotificationParams = {
  uri: string
  source?: string
  requestAuthAfterUnlock?: string
  requestOpenedWhileUnlocked?: string
}

type FunkeOpenIdPresentationNotificationScreenProps = {
  params?: OpenIdPresentationNotificationParams
  onMarkRequestOpenedWhileUnlocked?: () => void
}

export function FunkeOpenIdPresentationNotificationScreen(
  props: FunkeOpenIdPresentationNotificationScreenProps = {}
) {
  if (props.params) {
    return (
      <FunkeOpenIdPresentationNotificationScreenInner
        params={props.params}
        onMarkRequestOpenedWhileUnlocked={props.onMarkRequestOpenedWhileUnlocked}
      />
    )
  }

  return <FunkeOpenIdPresentationNotificationScreenRouted />
}

function FunkeOpenIdPresentationNotificationScreenRouted() {
  const params = useLocalSearchParams<OpenIdPresentationNotificationParams>()
  const router = useRouter()

  return (
    <FunkeOpenIdPresentationNotificationScreenInner
      params={params}
      onMarkRequestOpenedWhileUnlocked={() => router.setParams({ [requestOpenedWhileUnlockedParam]: '1' })}
    />
  )
}

function FunkeOpenIdPresentationNotificationScreenInner({
  params,
  onMarkRequestOpenedWhileUnlocked,
}: {
  params: OpenIdPresentationNotificationParams
  onMarkRequestOpenedWhileUnlocked?: () => void
}) {
  const { t } = useLingui()
  const { paradym } = useParadym('unlocked')
  const toast = useToastController()
  const exitWalletFlow = useExitWalletFlow(params.source)
  const [isDevelopmentModeEnabled] = useDevelopmentMode()
  const [errorReason, setErrorReason] = useState<string>()
  const [loadingStage, setLoadingStage] = useState<ResolveCredentialRequestStage>()

  const [resolvedRequest, setResolvedRequest] = useState<CredentialsForProofRequest>()
  const [formattedTransactionData, setFormattedTransactionData] = useState<FormattedTransactionData>()
  const [isSharing, setIsSharing] = useState(false)
  const shouldUsePin = useShouldUsePinForSubmission(resolvedRequest?.formattedSubmission)
  const needsRequestAuth =
    Boolean(shouldUsePin) &&
    (didUnlockForRequest(params[requestAuthAfterUnlockParam]) || !getWalletServiceProviderPin()?.length)

  useEffect(() => {
    if (
      didUnlockForRequest(params[requestAuthAfterUnlockParam]) ||
      didOpenRequestWhileUnlocked(params[requestOpenedWhileUnlockedParam])
    ) {
      return
    }

    onMarkRequestOpenedWhileUnlocked?.()
  }, [onMarkRequestOpenedWhileUnlocked, params])

  const handleError = useCallback(({ reason, description }: { reason: string; description?: string }) => {
    setIsSharing(false)
    setErrorReason(description ? `${reason}\n${description}` : reason)
    return
  }, [])

  const exitAfterProtocolResponse = useCallback(
    (options?: { redirectUri?: string }) => {
      exitWalletFlow(options?.redirectUri ? { didOpenExternalRedirect: true } : undefined)
    },
    [exitWalletFlow]
  )

  const reasonNoCredentials = t({
    id: 'presentation.noCredentialsSelected',
    message: 'No credentials selected',
    comment: 'Shown when the user tries to accept a proof but no credentials are loaded',
  })

  useEffect(() => {
    if (resolvedRequest) return

    paradym.openid4vc
      .resolveCredentialRequest({
        uri: params.uri,
        onProgress: setLoadingStage,
      })
      .then((r) => {
        setFormattedTransactionData(getFormattedTransactionData(r))
        setResolvedRequest(r)
      })
      .catch((error) => {
        const errorMessage =
          error instanceof Error && isDevelopmentModeEnabled ? `Development mode error: ${error.message}` : undefined

        handleError({
          reason: t(commonMessages.presentationInformationCouldNotBeExtracted),
          description: errorMessage,
        })
      })
      .finally(() => setLoadingStage(undefined))
  }, [resolvedRequest, params.uri, paradym.openid4vc, isDevelopmentModeEnabled, handleError, t])

  const { checkForOverAsking, isProcessingOverAsking, overAskingResponse, stopOverAsking } = useOverAskingAi()

  useEffect(() => {
    if (!resolvedRequest?.formattedSubmission || !resolvedRequest?.formattedSubmission.areAllSatisfied) {
      return
    }

    if (isProcessingOverAsking || overAskingResponse) {
      // Already generating or already has result
      return
    }

    const submission = resolvedRequest.formattedSubmission
    const requestedCards = submission.entries
      .filter((entry): entry is FormattedSubmissionEntrySatisfied => entry.isSatisfied)
      .flatMap((entry) => entry.credentials)

    void checkForOverAsking({
      verifier: {
        name: resolvedRequest.verifier.name ?? 'No name provided',
        domain: resolvedRequest.verifier.hostName ?? 'No domain provided',
      },
      name: submission.name ?? 'No name provided',
      purpose: submission.purpose ?? 'No purpose provided',
      cards: requestedCards.map((credential) => ({
        name: credential.credential.display.name ?? 'Card name',
        subtitle: credential.credential.display.description ?? 'Card description',
        requestedAttributes: getDisclosedAttributeNamesForDisplay(credential).map((c) =>
          typeof c === 'string' ? c : formatPredicate(c)
        ),
      })),
    })
  }, [resolvedRequest, checkForOverAsking, isProcessingOverAsking, overAskingResponse])

  const onProofAccept = useCallback(
    async ({
      pin,
      selectedCredentials,
      didUseBiometrics,
    }: {
      pin?: string
      selectedCredentials: SelectedCredentialsMap
      didUseBiometrics?: boolean
    }): Promise<{ completed: boolean; didOpenExternalRedirect?: boolean }> => {
      stopOverAsking()
      if (!resolvedRequest) {
        handleError({ reason: reasonNoCredentials })
        return { completed: false }
      }

      setIsSharing(true)

      try {
        if (shouldUsePin && !didUseBiometrics && pin) {
          await setWalletServiceProviderPinFromString(pin)
        }

        const result = await paradym.openid4vc.shareCredentials({
          resolvedRequest,
          selectedCredentials,
          acceptTransactionData: formattedTransactionData?.type === 'qes_authorization',
        })
        return {
          completed: true,
          didOpenExternalRedirect: Boolean(result.redirectUri),
        }
      } catch (error) {
        if (error instanceof ParadymWalletAuthenticationInvalidPinError) {
          toast.show(t(commonMessages.invalidPinEntered), {
            customData: {
              preset: 'danger',
            },
          })
          throw error
        }

        if (error instanceof ParadymWalletBiometricAuthenticationCancelledError) {
          return { completed: false }
        }

        paradym.logger.error('Error accepting presentation', {
          error,
        })

        handleError({
          reason: t(commonMessages.presentationCouldNotBeShared),
          description:
            error instanceof Error && isDevelopmentModeEnabled ? `Development mode error: ${error.message}` : undefined,
        })
        return { completed: false }
      } finally {
        setIsSharing(false)
      }
    },
    [
      resolvedRequest,
      paradym,
      shouldUsePin,
      stopOverAsking,
      toast,
      isDevelopmentModeEnabled,
      handleError,
      formattedTransactionData,
      reasonNoCredentials,
      t,
    ]
  )

  const onProofDecline = useCallback(async () => {
    stopOverAsking()
    if (!resolvedRequest) {
      exitWalletFlow()
      return
    }

    try {
      const result = await paradym.openid4vc.declineCredentialRequest({ resolvedRequest })
      exitAfterProtocolResponse(result)
    } catch (error) {
      paradym.logger.error('Error declining presentation', {
        error,
      })
      exitWalletFlow()
    }

    toast.show(t(commonMessages.informationRequestDeclined), {
      customData: { preset: 'danger' },
    })
  }, [resolvedRequest, exitAfterProtocolResponse, exitWalletFlow, stopOverAsking, t, toast, paradym])

  const onCancel = useCallback(async () => {
    stopOverAsking()

    if (!errorReason || !resolvedRequest) {
      exitWalletFlow()
      return
    }

    try {
      const result = await paradym.openid4vc.declineCredentialRequest({
        resolvedRequest,
        error: 'server_error',
        errorDescription: errorReason,
        activityStatus: 'failed',
      })
      exitAfterProtocolResponse(result)
    } catch (error) {
      paradym.logger.error('Error sending terminal OpenID4VP error response', {
        error,
      })
      exitWalletFlow()
    }
  }, [errorReason, exitAfterProtocolResponse, exitWalletFlow, paradym, resolvedRequest, stopOverAsking])

  const replace = useCallback(
    (options?: { didOpenExternalRedirect?: boolean }) => exitWalletFlow(options),
    [exitWalletFlow]
  )

  return (
    <FunkePresentationNotificationScreen
      key="presentation"
      surface={params.source === 'deeplink' && Platform.OS === 'android' ? 'sheet' : 'fullscreen'}
      usePin={needsRequestAuth}
      onAccept={onProofAccept}
      onDecline={onProofDecline}
      submission={resolvedRequest?.formattedSubmission}
      isAccepting={isSharing}
      entityId={resolvedRequest?.verifier.entityId}
      verifierName={resolvedRequest?.verifier.name}
      logo={resolvedRequest?.verifier.logo}
      trustMechanism={resolvedRequest?.trustMechanism}
      trustedEntities={resolvedRequest?.verifier.trustedEntities}
      onComplete={replace}
      onCancel={onCancel}
      overAskingResponse={overAskingResponse}
      transaction={formattedTransactionData}
      errorReason={errorReason}
      loadingStage={loadingStage}
    />
  )
}
