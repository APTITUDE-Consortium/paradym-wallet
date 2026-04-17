import { sendErrorResponse } from '@animo-id/expo-digital-credentials-api'
import { setWalletServiceProviderPinFromString, setupWalletServiceProvider } from '@easypid/crypto/WalletServiceProviderClient'
import { DcApiComponentProviders } from '@easypid/features/dcApi/DcApiComponentProviders'
import { useBiometricsType } from '@easypid/hooks/useBiometricsType'
import { useLingui } from '@lingui/react/macro'
import type { PinDotsInputRef } from '@package/app'
import { commonMessages } from '@package/translations'
import { FlowSurface, useToastController, YStack } from '@package/ui'
import type { CredentialsForProofRequest, DigitalCredentialsRequest } from '@paradym/wallet-sdk'
import {
  ParadymWalletAuthenticationInvalidPinError,
  ParadymWalletBiometricAuthenticationCancelledError,
  useCanUseBiometryBackedWalletKey,
  useIsBiometricsEnabled,
  useParadym,
} from '@paradym/wallet-sdk'
import type { ParadymWalletSdk } from '@paradym/wallet-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ConsentAuthSection, ConsentLoadingSection, ConsentPartyHeader } from '../consent/ConsentBlocks'

type DcApiSharingScreenProps = {
  request: DigitalCredentialsRequest
}

export function DcApiSharingScreen({ request }: DcApiSharingScreenProps) {
  return (
    <DcApiComponentProviders>
      <DcApiSharingScreenWithContext request={request} />
    </DcApiComponentProviders>
  )
}

export function DcApiSharingScreenWithContext({ request }: DcApiSharingScreenProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [isResolvingRequest, setIsResolvingRequest] = useState(false)
  const [resolvedRequest, setResolvedRequest] = useState<CredentialsForProofRequest>()
  const pinRef = useRef<PinDotsInputRef>(null)
  const { t } = useLingui()
  const toast = useToastController()
  const paradym = useParadym()
  const paradymRef = useRef(paradym)
  const hasAttemptedAutoBiometricsRef = useRef(false)
  const hasAttemptedAutoShareRef = useRef(false)
  const biometricsType = useBiometricsType()
  const [isBiometricsEnabled] = useIsBiometricsEnabled()
  const canUseBiometryBackedWalletKey = useCanUseBiometryBackedWalletKey()
  const isUnlockTransitioning = paradym.state === 'acquired-wallet-key'
  const canRequestBiometrics =
    paradym.state === 'locked' &&
    paradym.canTryUnlockingUsingBiometrics &&
    isBiometricsEnabled &&
    canUseBiometryBackedWalletKey

  useEffect(() => {
    paradymRef.current = paradym
  }, [paradym])

  const sendDcApiError = useCallback(
    (errorMessage: string, error?: unknown) => {
      if (paradymRef.current.state === 'unlocked') {
        paradymRef.current.paradym.logger.error(errorMessage, { error })
      } else if (error) {
        console.error(errorMessage, error)
      }

      sendErrorResponse({ errorMessage })
    },
    []
  )

  const resolveSharingRequest = useCallback(
    async (sdk: ParadymWalletSdk) => {
      if (resolvedRequest) return resolvedRequest

      setIsResolvingRequest(true)

      try {
        const nextResolvedRequest = await sdk.dcApi.resolveRequest({ request })

        if (nextResolvedRequest.formattedSubmission.entries.length > 1) {
          throw new Error('Multiple cards requested, but only one card can be shared with the digital credentials api.')
        }

        setResolvedRequest(nextResolvedRequest)
        return nextResolvedRequest
      } catch (error) {
        sdk.logger.error('Error getting credentials for dc api request', {
          error,
        })

        sendDcApiError('Presentation information could not be extracted', error)
      } finally {
        setIsResolvingRequest(false)
      }
    },
    [request, resolvedRequest, sendDcApiError]
  )

  const onShareResponse = useCallback(
    async (sdk: ParadymWalletSdk, sharingRequest?: CredentialsForProofRequest) => {
      const nextResolvedRequest = sharingRequest ?? (await resolveSharingRequest(sdk))
      if (!nextResolvedRequest) return

      try {
        await sdk.dcApi.sendResponse({
          dcRequest: request,
          resolvedRequest: nextResolvedRequest,
        })
      } catch (error) {
        sdk.logger.error('Could not share response', { error })

        sendDcApiError('Unable to share credentials', error)
      }
    },
    [request, resolveSharingRequest, sendDcApiError]
  )

  const getUnlockedSdk = useCallback(async () => {
    const currentParadym = paradymRef.current

    if (currentParadym.state === 'unlocked') {
      return currentParadym.paradym
    }

    if (currentParadym.state === 'acquired-wallet-key') {
      const sdk = await currentParadym.unlock()
      await setupWalletServiceProvider(sdk)
      return sdk
    }

    throw new Error(`Invalid state. Received: '${currentParadym.state}'`)
  }, [])

  const waitForUnlockedState = useCallback(async () => {
    const timeoutAt = Date.now() + 5000

    while (Date.now() < timeoutAt) {
      const currentParadym = paradymRef.current
      if (currentParadym.state !== 'locked' && currentParadym.state !== 'initializing') {
        return currentParadym
      }

      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    throw new Error('Timed out while waiting for the wallet to unlock')
  }, [])

  const handleAuthFailure = useCallback((error: unknown) => {
    if (error instanceof ParadymWalletAuthenticationInvalidPinError) {
      pinRef.current?.clear()
      pinRef.current?.shake()
      toast.show(t(commonMessages.invalidPinEntered), { customData: { preset: 'danger' } })
      return
    }

    if (error instanceof ParadymWalletBiometricAuthenticationCancelledError) return

    sendDcApiError('Unable to share credentials', error)
  }, [sendDcApiError, t, toast])

  const onUnlockSdk = async (pin: string) => {
    setIsProcessing(true)
    try {
      if (paradym.state === 'locked') {
        await paradym.unlockUsingPin(pin)
        await setWalletServiceProviderPinFromString(pin, false)
        await waitForUnlockedState()
      }

      const sdk = await getUnlockedSdk()
      const sharingRequest = await resolveSharingRequest(sdk)
      if (!sharingRequest) return
      await onShareResponse(sdk, sharingRequest)
    } catch (error) {
      handleAuthFailure(error)
    } finally {
      setIsProcessing(false)
    }
  }

  const onBiometricsTap = async () => {
    setIsProcessing(true)
    try {
      if (paradym.state === 'locked') {
        await paradym.tryUnlockingUsingBiometrics()
        await waitForUnlockedState()
      }

      const sdk = await getUnlockedSdk()
      const sharingRequest = await resolveSharingRequest(sdk)
      if (!sharingRequest) return
      await onShareResponse(sdk, sharingRequest)
    } catch (error) {
      handleAuthFailure(error)
    } finally {
      setIsProcessing(false)
    }
  }

  useEffect(() => {
    if (!canRequestBiometrics || hasAttemptedAutoBiometricsRef.current || isProcessing) return
    hasAttemptedAutoBiometricsRef.current = true
    void onBiometricsTap()
  }, [canRequestBiometrics, isProcessing, onBiometricsTap])

  useEffect(() => {
    if (paradym.state !== 'unlocked' || hasAttemptedAutoShareRef.current || isProcessing || isResolvingRequest) return

    hasAttemptedAutoShareRef.current = true
    setIsProcessing(true)
    void resolveSharingRequest(paradym.paradym)
      .then(async (sharingRequest) => {
        if (!sharingRequest) return
        await onShareResponse(paradym.paradym, sharingRequest)
      })
      .finally(() => {
        setIsProcessing(false)
      })
  }, [isProcessing, isResolvingRequest, onShareResponse, paradym, resolveSharingRequest])

  const verifierName = resolvedRequest?.verifier.name ?? request.origin ?? t(commonMessages.unknownOrganization)
  const verifierSubtitle =
    resolvedRequest?.verifier.hostName ?? (resolvedRequest?.verifier.name ? request.origin : undefined)
  const overlayLogo = resolvedRequest?.verifier.logo
  const isSendingResponse = isProcessing && paradym.state === 'unlocked' && !isResolvingRequest && !!resolvedRequest
  const unverifiedLabel =
    resolvedRequest && !resolvedRequest.trustMechanism
      ? t({
          id: 'verifyPartySlide.organizationNotVerifiedHeading',
          message: 'Organization not verified',
          comment: 'Badge shown when the relying party or issuer could not be verified',
        })
      : undefined

  return (
    <FlowSurface surface="sheet" sheetVariant="docked" logo={overlayLogo}>
      <YStack gap="$5">
        <ConsentPartyHeader
          hideLogo={Boolean(overlayLogo)}
          logo={overlayLogo}
          title={verifierName}
          subtitle={verifierSubtitle}
          badgeLabel={unverifiedLabel}
        />
        {isUnlockTransitioning || isResolvingRequest || isSendingResponse ? (
          <ConsentLoadingSection
            title={
              isSendingResponse
                ? t({
                    id: 'dcApiSharing.sendingTitle',
                    message: 'Sending response',
                    comment: 'Title shown while the wallet sends the DC-API response',
                  })
                : t({
                    id: 'dcApiSharing.unlockingTitle',
                    message: 'Please wait',
                    comment: 'Title shown while the wallet finishes unlocking after successful authentication',
                  })
            }
            description={
              isSendingResponse
                ? t({
                    id: 'dcApiSharing.sendingDescription',
                    message: 'Please wait while your wallet sends the response.',
                    comment: 'Description shown while the wallet sends the DC-API response',
                  })
                : t({
                    id: 'dcApiSharing.unlockingDescription',
                    message: 'Preparing the request and unlocking your wallet.',
                    comment: 'Description shown while the wallet finishes unlocking before responding to the DC-API request',
                  })
            }
          />
        ) : (
          <ConsentAuthSection
            title={t({
              id: 'dcApiSharing.confirmHeading',
              message: 'Confirm with PIN',
              comment: 'Heading shown on the dc-api sharing screen',
            })}
            description={t({
              id: 'dcApiSharing.confirmDescription',
              message: 'Approve this request to share data.',
              comment: 'Description shown on the dc-api sharing screen',
            })}
            onPinComplete={onUnlockSdk}
            onBiometricsTap={canRequestBiometrics ? onBiometricsTap : undefined}
            biometricsType={biometricsType ?? 'fingerprint'}
            pinRef={pinRef}
            isLoading={isProcessing}
          />
        )}
      </YStack>
    </FlowSurface>
  )
}
