import {
  type DigitalCredentialsCreateRequest,
  sendCreateErrorResponse,
  sendCreateResponse,
} from '@animo-id/expo-digital-credentials-api'
import { walletClient } from '@easypid/constants'
import { DcApiComponentProviders } from '@easypid/features/dcApi/DcApiComponentProviders'
import { useDevelopmentMode } from '@easypid/hooks'
import { useBiometricsType } from '@easypid/hooks/useBiometricsType'
import { useLingui } from '@lingui/react/macro'
import type { PinDotsInputRef } from '@package/app'
import { commonMessages } from '@package/translations'
import { Button, FlowSurface, Paragraph, type ScrollViewRefType, useToastController, XStack, YStack } from '@package/ui'
import type {
  CredentialForDisplay,
  DeferredCredentialBefore,
  ParadymWalletSdk,
  ResolveCredentialOfferReturn,
} from '@paradym/wallet-sdk'
import {
  ParadymWalletAuthenticationInvalidPinError,
  ParadymWalletBiometricAuthenticationCancelledError,
  getCredentialForDisplayId,
  useCanUseBiometryBackedWalletKey,
  useIsBiometricsEnabled,
  useParadym,
} from '@paradym/wallet-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { dcApiRegisterOptions } from '../../utils/dcApiRegisterOptions'
import { setWalletServiceProviderPinFromString } from '../../crypto/WalletServiceProviderClient'
import {
  ConsentAuthSection,
  ConsentCredentialPreview,
  ConsentLoadingSection,
  ConsentPartyHeader,
  ConsentSection,
} from '../consent/ConsentBlocks'

const tryParseJson = (value: string) => {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const getCredentialOfferRequestData = (request: DigitalCredentialsCreateRequest) => {
  const requestPayload = request.request as
    | { data?: unknown }
    | { requests?: Array<{ data?: unknown }> }
    | { providers?: Array<{ request?: unknown }> }
    | undefined

  if (!requestPayload) return undefined
  if ('data' in requestPayload) return requestPayload.data
  if ('requests' in requestPayload && Array.isArray(requestPayload.requests)) {
    return requestPayload.requests[0]?.data
  }
  if ('providers' in requestPayload && Array.isArray(requestPayload.providers)) {
    return requestPayload.providers[0]?.request
  }
  return undefined
}

const getCredentialOfferUri = (request: DigitalCredentialsCreateRequest) => {
  const data = getCredentialOfferRequestData(request)
  if (!data) return null

  if (typeof data === 'string') {
    const trimmed = data.trim()
    const parsed = trimmed.startsWith('{') || trimmed.startsWith('[') ? tryParseJson(trimmed) : undefined
    if (parsed) {
      return getCredentialOfferUri({
        ...request,
        request: { protocol: request.request?.protocol ?? 'openid4vci', data: parsed },
      })
    }

    return trimmed
  }

  if (typeof data !== 'object') return null

  const payload = data as Record<string, unknown>
  const credentialOfferUri =
    (payload.credential_offer_uri as string | undefined) ??
    (payload.credentialOfferUri as string | undefined) ??
    (payload.offer_uri as string | undefined) ??
    (payload.offerUri as string | undefined)

  if (credentialOfferUri) {
    return `openid-credential-offer://?credential_offer_uri=${encodeURIComponent(credentialOfferUri)}`
  }

  const credentialOffer =
    (payload.credential_offer as object | undefined) ??
    (payload.credentialOffer as object | undefined) ??
    (payload.offer as object | undefined)

  if (credentialOffer) {
    return `openid-credential-offer://?credential_offer=${encodeURIComponent(JSON.stringify(credentialOffer))}`
  }

  if (payload.credential_issuer || payload.issuer) {
    return `openid-credential-offer://?credential_offer=${encodeURIComponent(JSON.stringify(payload))}`
  }

  return null
}

type DcApiIssuanceScreenProps = {
  request: DigitalCredentialsCreateRequest
}

export function DcApiIssuanceScreen({ request }: DcApiIssuanceScreenProps) {
  return (
    <DcApiComponentProviders>
      <DcApiIssuanceScreenWithContext request={request} />
    </DcApiComponentProviders>
  )
}

function DcApiIssuanceScreenWithContext({ request }: DcApiIssuanceScreenProps) {
  const { t } = useLingui()
  const toast = useToastController()
  const [isDevelopmentModeEnabled] = useDevelopmentMode()
  const biometricsType = useBiometricsType()
  const [isBiometricsEnabled] = useIsBiometricsEnabled()
  const canUseBiometryBackedWalletKey = useCanUseBiometryBackedWalletKey()
  const paradym = useParadym()
  const pinRef = useRef<PinDotsInputRef>(null)
  const unlockedSdk = paradym.state === 'unlocked' ? (paradym as { paradym: ParadymWalletSdk }).paradym : undefined

  const [isUnlocking, setIsUnlocking] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [errorReason, setErrorReason] = useState<string>()
  const [stage, setStage] = useState<'review' | 'auth'>('review')
  const hasAttemptedAutoBiometricsRef = useRef(false)
  const [hasReachedBottom, setHasReachedBottom] = useState(false)
  const [shouldFinishAfterUnlock, setShouldFinishAfterUnlock] = useState(false)
  const [resolvedOffer, setResolvedOffer] = useState<ResolveCredentialOfferReturn>()
  const [_deferredCredential, setDeferredCredential] = useState<DeferredCredentialBefore>()
  const [_receivedCredential, setReceivedCredential] = useState<CredentialForDisplay>()
  const scrollRef = useRef<ScrollViewRefType>(null)
  const scrollMetricsRef = useRef({ contentHeight: 0, viewportHeight: 0 })
  const needsWalletAuth = paradym.state !== 'unlocked'
  const isUnlockTransitioning = isUnlocking && paradym.state === 'acquired-wallet-key'
  const canRequestBiometrics =
    stage === 'auth' &&
    paradym.state === 'locked' &&
    paradym.canTryUnlockingUsingBiometrics &&
    isBiometricsEnabled &&
    canUseBiometryBackedWalletKey

  const updateHasReachedBottom = useCallback((offsetY = 0) => {
    const { contentHeight, viewportHeight } = scrollMetricsRef.current
    const paddingToBottom = 24
    setHasReachedBottom(viewportHeight + offsetY >= contentHeight - paddingToBottom)
  }, [])

  const handleScroll = useCallback(
    (event: {
      nativeEvent: {
        contentOffset: { y: number }
        layoutMeasurement: { height: number }
        contentSize: { height: number }
      }
    }) => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent
      scrollMetricsRef.current = {
        contentHeight: contentSize.height,
        viewportHeight: layoutMeasurement.height,
      }
      updateHasReachedBottom(contentOffset.y)
    },
    [updateHasReachedBottom]
  )

  const offerUri = useMemo(() => getCredentialOfferUri(request), [request])
  const logo = resolvedOffer?.credentialDisplay.issuer.logo

  const setErrorReasonWithError = useCallback(
    (baseMessage: string, error: unknown) => {
      if (isDevelopmentModeEnabled && error instanceof Error) {
        setErrorReason(`${baseMessage}\n\nDevelopment mode error:\n${error.message}`)
      } else {
        setErrorReason(baseMessage)
      }
    },
    [isDevelopmentModeEnabled]
  )

  useEffect(() => {
    if (offerUri) return
    sendCreateErrorResponse({ errorMessage: 'Invalid credential offer' })
  }, [offerUri])

  useEffect(() => {
    if (!offerUri || resolvedOffer || !unlockedSdk) return

    unlockedSdk.openid4vc
      .resolveCredentialOffer({
        offerUri,
        authorization: walletClient,
      })
      .then((result) => setResolvedOffer(result))
      .catch((error) => {
        unlockedSdk.logger.error(`Couldn't resolve OpenID4VCI offer`, { error })
        setErrorReasonWithError(t(commonMessages.credentialInformationCouldNotBeExtracted), error)
      })
  }, [offerUri, resolvedOffer, setErrorReasonWithError, t, unlockedSdk])

  useEffect(() => {
    if (!resolvedOffer) return

    pinRef.current?.clear()
    setStage('review')
  }, [resolvedOffer])

  const updateCredentials = useCallback(
    (options: { deferredCredentials: DeferredCredentialBefore[]; credentials: CredentialForDisplay[] }) => {
      if (options.deferredCredentials.length > 0 && options.credentials.length > 0) {
        setErrorReasonWithError(
          t(commonMessages.credentialInformationCouldNotBeExtracted),
          new Error('Received both immediate and deferred credentials')
        )
        return
      }

      if (options.deferredCredentials.length) {
        setDeferredCredential(options.deferredCredentials[0])
      }

      if (options.credentials.length) {
        setReceivedCredential(options.credentials[0])
      }
    },
    [setErrorReasonWithError, t]
  )

  const completeAndReturn = useCallback(
    async (
      sdk: ParadymWalletSdk,
      offer: ResolveCredentialOfferReturn,
      acquiredCredentials: { deferredCredentials: DeferredCredentialBefore[]; credentials: CredentialForDisplay[] }
    ) => {
      const deferred = acquiredCredentials.deferredCredentials[0]
      const received = acquiredCredentials.credentials[0]

      await sdk.openid4vc.completeCredentialRetrieval({
        resolvedCredentialOffer: offer.resolvedCredentialOffer,
        recordToStore: received
          ? dcApiRegisterOptions({ paradym: sdk, credentialRecord: received.record })
          : undefined,
        deferredCredential: deferred,
      })

      sendCreateResponse({
        response: JSON.stringify({ protocol: 'openid4vci', data: {} }),
        type: request.type,
        newEntryId: received ? getCredentialForDisplayId(received.record) : undefined,
      })
    },
    [request.type]
  )

  const acquireCredential = useCallback(
    async (sdk: ParadymWalletSdk, offer: ResolveCredentialOfferReturn) => {
      try {
        if (offer.flow === 'pre-auth' || offer.flow === 'pre-auth-with-tx-code') {
          const acquiredCredentials = await sdk.openid4vc.acquireCredentials({
            resolvedCredentialOffer: offer.resolvedCredentialOffer,
            transactionCode: undefined,
          })

          updateCredentials(acquiredCredentials)
          return acquiredCredentials
        }

        if (offer.flow === 'auth-presentation-during-issuance') {
          const acquiredCredentials = await sdk.openid4vc.acquireCredentials({
            authorization: walletClient,
            resolvedCredentialOffer: offer.resolvedCredentialOffer,
            resolvedAuthorizationRequest: offer.resolvedAuthorizationRequest,
            credentialsForRequest: offer.credentialsForProofRequest,
          })

          updateCredentials(acquiredCredentials)
          return acquiredCredentials
        }

        const acquiredCredentials = await sdk.openid4vc.acquireCredentials({
          authorization: walletClient,
          resolvedCredentialOffer: offer.resolvedCredentialOffer,
          resolvedAuthorizationRequest: offer.resolvedAuthorizationRequest,
        })

        updateCredentials(acquiredCredentials)
        return acquiredCredentials
      } catch (error) {
        if (error instanceof ParadymWalletBiometricAuthenticationCancelledError) {
          setErrorReason(t(commonMessages.biometricAuthenticationCancelled))
          return undefined
        }

        sdk.logger.error(`Couldn't receive credential from OpenID4VCI offer`, { error })
        setErrorReasonWithError(t(commonMessages.errorWhileRetrievingCredentials), error)
        return undefined
      }
    },
    [setErrorReasonWithError, t, updateCredentials]
  )

  const finishIssuance = useCallback(
    async (sdk: ParadymWalletSdk) => {
      setIsCompleting(true)
      try {
        let offer = resolvedOffer

        if (!offer && offerUri) {
          offer = await sdk.openid4vc.resolveCredentialOffer({
            offerUri,
            authorization: walletClient,
          })
          setResolvedOffer(offer)
        }

        if (!offer) return

        const acquiredCredentials = await acquireCredential(sdk, offer)
        if (!acquiredCredentials) return

        await completeAndReturn(sdk, offer, acquiredCredentials)
      } finally {
        setIsCompleting(false)
      }
    },
    [acquireCredential, completeAndReturn, offerUri, resolvedOffer]
  )

  const handleIssuanceError = useCallback(
    (error: unknown) => {
      if (error instanceof ParadymWalletAuthenticationInvalidPinError) {
        pinRef.current?.clear()
        pinRef.current?.shake()
        toast.show(t(commonMessages.invalidPinEntered), { customData: { preset: 'warning' } })
        return
      }

      setErrorReasonWithError(t(commonMessages.presentationCouldNotBeShared), error)
    },
    [setErrorReasonWithError, t, toast]
  )

  useEffect(() => {
    if (!shouldFinishAfterUnlock) return
    if (paradym.state === 'locked' || paradym.state === 'initializing' || paradym.state === 'not-configured') return

    const continueFlow = async () => {
      try {
        const sdk =
          paradym.state === 'acquired-wallet-key'
            ? await paradym.unlock()
            : paradym.state === 'unlocked'
              ? paradym.paradym
              : undefined

        if (!sdk) return
        await finishIssuance(sdk)
      } catch (error) {
        handleIssuanceError(error)
      } finally {
        setShouldFinishAfterUnlock(false)
        setIsUnlocking(false)
      }
    }

    void continueFlow()
  }, [finishIssuance, handleIssuanceError, paradym, shouldFinishAfterUnlock])

  const onUnlock = useCallback(
    async (enteredPin: string) => {
      setIsUnlocking(true)
      let isAwaitingStateTransition = false
      try {
        if (paradym.state === 'locked') {
          isAwaitingStateTransition = true
          setShouldFinishAfterUnlock(true)
          await paradym.unlockUsingPin(enteredPin)
          await setWalletServiceProviderPinFromString(enteredPin, false)
          return
        }

        const sdk =
          paradym.state === 'acquired-wallet-key'
            ? await paradym.unlock()
            : paradym.state === 'unlocked'
              ? paradym.paradym
              : undefined

        if (!sdk) return
        await finishIssuance(sdk)
      } catch (error) {
        isAwaitingStateTransition = false
        setShouldFinishAfterUnlock(false)
        handleIssuanceError(error)
      } finally {
        if (!isAwaitingStateTransition) {
          setIsUnlocking(false)
        }
      }
    },
    [
      finishIssuance,
      handleIssuanceError,
      paradym,
    ]
  )

  const onBiometricsTap = useCallback(() => {
    if (canRequestBiometrics) {
      setIsUnlocking(true)
      void paradym
        .tryUnlockingUsingBiometrics()
        .then(() => {
          void onUnlock('')
        })
        .catch((error) => {
          if (error instanceof ParadymWalletBiometricAuthenticationCancelledError) return

          setErrorReasonWithError(t(commonMessages.presentationCouldNotBeShared), error)
        })
        .finally(() => {
          setIsUnlocking(false)
      })
    }
  }, [canRequestBiometrics, onUnlock, paradym, setErrorReasonWithError, t])

  useEffect(() => {
    if (stage !== 'auth') {
      hasAttemptedAutoBiometricsRef.current = false
      return
    }

    if (!canRequestBiometrics || hasAttemptedAutoBiometricsRef.current || isUnlocking) return
    hasAttemptedAutoBiometricsRef.current = true
    onBiometricsTap()
  }, [canRequestBiometrics, isUnlocking, onBiometricsTap, stage])

  const footer =
    stage === 'auth' ? (
      <Button.Outline
        onPress={() => {
          pinRef.current?.clear()
          setStage('review')
        }}
        disabled={isUnlocking || isCompleting}
      >
        {t(commonMessages.backButton)}
      </Button.Outline>
    ) : (
      <XStack gap="$3">
        <Button.Outline
          flex={1}
          onPress={() => sendCreateErrorResponse({ errorMessage: t(commonMessages.informationRequestDeclined) })}
        >
          {t(commonMessages.stop)}
        </Button.Outline>
        <Button.Solid
          flex={1}
          onPress={() => {
            if (!hasReachedBottom) {
              scrollRef.current?.scrollToEnd({ animated: true })
              setHasReachedBottom(true)
              return
            }

            if (needsWalletAuth) {
              setStage('auth')
              return
            }

            void onUnlock('')
          }}
          disabled={isUnlocking || isCompleting || !offerUri}
        >
          {t(commonMessages.acceptButton)}
        </Button.Solid>
      </XStack>
    )

  const subtitle =
    resolvedOffer?.flow === 'auth-presentation-during-issuance'
      ? t({
          id: 'dcApiIssuance.subtitle.presentation',
          message: 'Swipe up to review the requested data before approving the issuance.',
          comment: 'Subtitle shown for issuance requests that also need a presentation during issuance',
        })
      : t({
          id: 'dcApiIssuance.subtitle.default',
          message: 'Review the issuer request before you confirm it.',
          comment: 'Subtitle shown on the issuance consent screen',
        })

  return (
    <FlowSurface
      surface="sheet"
      sheetVariant="docked"
      logo={logo}
      footer={footer}
      scrollRef={scrollRef}
      scrollViewProps={{
        onScroll: handleScroll,
        onLayout: (event) => {
          scrollMetricsRef.current.viewportHeight = event.nativeEvent.layout.height
          updateHasReachedBottom()
        },
        onContentSizeChange: (_width, height) => {
          scrollMetricsRef.current.contentHeight = height
          updateHasReachedBottom()
        },
        scrollEventThrottle: 16,
      }}
    >
      <YStack gap="$5">
        <YStack gap="$3">
          <ConsentPartyHeader
            hideLogo
            logo={logo}
            title={
              stage === 'auth'
                ? t({
                    id: 'dcApiIssuance.pinHeading',
                    message: 'Confirm with PIN or biometrics',
                    comment: 'Heading for the wallet authentication step',
                  })
                : resolvedOffer?.credentialDisplay.name ??
                  t({
                    id: 'dcApiIssuance.title',
                    message: 'Add credential',
                    comment: 'Title shown on the issuance consent screen',
                  })
            }
            subtitle={resolvedOffer?.credentialDisplay.issuer.name ?? request.origin ?? request.packageName}
          />
          <Paragraph color="$grey-700">
            {stage === 'auth'
              ? t({
                  id: 'dcApiIssuance.pinDescription',
                  message: 'Approve this issuance with your app PIN or biometrics.',
                  comment: 'Description shown above the authentication control',
                })
              : subtitle}
          </Paragraph>
        </YStack>

        <YStack gap="$5">
          {stage === 'review' && resolvedOffer ? (
            <ConsentCredentialPreview credentialDisplay={resolvedOffer.credentialDisplay} />
          ) : null}

          {errorReason ? (
            <ConsentSection tone="danger" title={t(commonMessages.pleaseTryAgain)} description={errorReason} />
          ) : null}

          {isCompleting ? (
            <ConsentLoadingSection
              title={t({
                id: 'receiveCredential.acceptingTitle',
                message: 'Accepting credential',
                comment: 'Title shown while the credential is being issued',
              })}
              description={t({
                id: 'receiveCredential.acceptingDescription',
                message: 'Please wait while the issuer completes the issuance.',
                comment: 'Description shown while the credential is being issued',
              })}
            />
          ) : stage === 'auth' ? (
            isUnlockTransitioning ? (
              <ConsentLoadingSection
                title={t({
                  id: 'dcApiIssuance.unlockingTitle',
                  message: 'Please wait',
                  comment: 'Title shown while the wallet finishes unlocking after successful authentication',
                })}
                description={t({
                  id: 'dcApiIssuance.unlockingDescription',
                  message: 'Unlocking your wallet and preparing the issuer response.',
                  comment:
                    'Description shown while the wallet finishes unlocking before continuing the DC-API issuance flow',
                })}
              />
            ) : (
              <ConsentAuthSection
                title={t({
                  id: 'dcApiIssuance.pinHeading',
                  message: 'Confirm with PIN or biometrics',
                  comment: 'Heading for the wallet authentication step',
                })}
                description={t({
                  id: 'dcApiIssuance.pinDescription',
                  message: 'Approve this issuance with your app PIN or biometrics.',
                  comment: 'Description shown above the authentication control',
                })}
                onPinComplete={(value) => {
                  void onUnlock(value)
                }}
                onBiometricsTap={canRequestBiometrics ? onBiometricsTap : undefined}
                biometricsType={biometricsType ?? 'fingerprint'}
                isLoading={isUnlocking}
              />
            )
          ) : null}
        </YStack>
      </YStack>
    </FlowSurface>
  )
}
