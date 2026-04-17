import { sendCreateErrorResponse, sendCreateResponse } from '@animo-id/expo-digital-credentials-api'
import { appScheme, walletClient } from '@easypid/constants'
import { useDevelopmentMode } from '@easypid/hooks'
import { useBiometricsType } from '@easypid/hooks/useBiometricsType'
import { dcApiRegisterOptions } from '@easypid/utils/dcApiRegisterOptions'
import { useLingui } from '@lingui/react/macro'
import type { PinDotsInputRef } from '@package/app'
import { commonMessages } from '@package/translations'
import {
  Button,
  FlowSurface,
  Heading,
  HeroIcons,
  Input,
  Paragraph,
  ScrollView,
  Stack,
  useToastController,
  XStack,
  YStack,
} from '@package/ui'
import type { CredentialForDisplay, DeferredCredentialBefore, ResolveCredentialOfferReturn } from '@paradym/wallet-sdk'
import {
  getCredentialForDisplayId,
  ParadymWalletAuthenticationInvalidPinError,
  ParadymWalletBiometricAuthenticationCancelledError,
  type ResolveCredentialOfferStage,
  useCanUseBiometryBackedWalletKey,
  useIsBiometricsEnabled,
  useParadym,
} from '@paradym/wallet-sdk'
import { useGlobalSearchParams, useLocalSearchParams, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import {
  getWalletServiceProviderPin,
  setWalletServiceProviderPinFromString,
} from '../../crypto/WalletServiceProviderClient'
import { useExitWalletFlow } from '../../hooks/useExitWalletFlow'
import { useShouldUsePinForSubmission } from '../../hooks/useShouldUsePinForPresentation'
import {
  ConsentAuthSection,
  ConsentCredentialPreview,
  ConsentErrorState,
  ConsentLoadingSection,
  ConsentPartyHeader,
  ConsentSection,
} from '../consent/ConsentBlocks'
import { getIssuanceLoadingCopy } from '../consent/loadingStageCopy'
import {
  didOpenRequestWhileUnlocked,
  didUnlockForRequest,
  requestAuthAfterUnlockParam,
  requestOpenedWhileUnlockedParam,
} from '../navigation/redirectAfterUnlock'

export type OpenIdCredentialNotificationParams = {
  uri: string
  dcApi?: string
  source?: string
  requestAuthAfterUnlock?: string
  requestOpenedWhileUnlocked?: string
}

export type OpenIdCredentialAuthorizationParams = {
  credentialAuthorizationCode?: string
  credentialAuthorizationError?: string
  credentialAuthorizationErrorDescription?: string
}

type FunkeCredentialNotificationScreenProps = {
  params?: OpenIdCredentialNotificationParams
  authorizationParams?: OpenIdCredentialAuthorizationParams
  onMarkRequestOpenedWhileUnlocked?: () => void
}

export function FunkeCredentialNotificationScreen(props: FunkeCredentialNotificationScreenProps = {}) {
  if (props.params) {
    return (
      <FunkeCredentialNotificationScreenInner
        params={props.params}
        authorizationParams={props.authorizationParams}
        onMarkRequestOpenedWhileUnlocked={props.onMarkRequestOpenedWhileUnlocked}
      />
    )
  }

  return <FunkeCredentialNotificationScreenRouted />
}

function FunkeCredentialNotificationScreenRouted() {
  const params = useLocalSearchParams<OpenIdCredentialNotificationParams>()
  const authorizationParams = useGlobalSearchParams<OpenIdCredentialAuthorizationParams>()
  const router = useRouter()

  return (
    <FunkeCredentialNotificationScreenInner
      params={params}
      authorizationParams={authorizationParams}
      onMarkRequestOpenedWhileUnlocked={() => router.setParams({ [requestOpenedWhileUnlockedParam]: '1' })}
    />
  )
}

function FunkeCredentialNotificationScreenInner({
  params,
  authorizationParams,
  onMarkRequestOpenedWhileUnlocked,
}: {
  params: OpenIdCredentialNotificationParams
  authorizationParams?: OpenIdCredentialAuthorizationParams
  onMarkRequestOpenedWhileUnlocked?: () => void
}) {
  const { paradym } = useParadym('unlocked')
  const walletParadym = useParadym()
  const { credentialAuthorizationCode, credentialAuthorizationError, credentialAuthorizationErrorDescription } =
    authorizationParams ?? {}
  const toast = useToastController()
  const { t } = useLingui()
  const exitWalletFlow = useExitWalletFlow(params.source)
  const [isDevelopmentModeEnabled] = useDevelopmentMode()
  const [isBiometricsEnabled] = useIsBiometricsEnabled()
  const canUseBiometryBackedWalletKey = useCanUseBiometryBackedWalletKey()
  const biometricsType = useBiometricsType()

  const [errorReason, setErrorReason] = useState<string>()
  const [loadingStage, setLoadingStage] = useState<ResolveCredentialOfferStage>()
  const [resolvedCredentialOffer, setResolvedCredentialOffer] = useState<ResolveCredentialOfferReturn>()
  const [isBusy, setIsBusy] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)
  const [txCodeEntry, setTxCodeEntry] = useState('')
  const [browserResult, setBrowserResult] = useState<WebBrowser.WebBrowserAuthSessionResult>()
  const [handledAuthResult, setHandledAuthResult] = useState(false)
  const [deferredCredential, setDeferredCredential] = useState<DeferredCredentialBefore>()
  const [_receivedCredential, setReceivedCredential] = useState<CredentialForDisplay>()
  const [presentationStage, setPresentationStage] = useState<'review' | 'auth'>('review')
  const hasAttemptedPresentationBiometricsRef = useRef(false)
  const pinRef = useRef<PinDotsInputRef>(null)

  const isDcApiRequest = params.dcApi === '1'
  const surface = params.source === 'deeplink' && Platform.OS === 'android' ? 'sheet' : 'fullscreen'
  const isOverlay = surface === 'sheet'
  const activeWalletClient =
    Platform.OS === 'android' && params.source === 'deeplink'
      ? {
          ...walletClient,
          redirectUri: `${appScheme}:///wallet/redirect`,
        }
      : walletClient
  const shouldUsePinForPresentation = useShouldUsePinForSubmission(
    resolvedCredentialOffer?.flow === 'auth-presentation-during-issuance'
      ? resolvedCredentialOffer.credentialsForProofRequest.formattedSubmission
      : undefined
  )
  const needsPresentationWalletAuth =
    Boolean(shouldUsePinForPresentation) &&
    (didUnlockForRequest(params[requestAuthAfterUnlockParam]) || !getWalletServiceProviderPin()?.length)
  const canRequestPresentationBiometrics =
    presentationStage === 'auth' &&
    needsPresentationWalletAuth &&
    walletParadym.state === 'locked' &&
    walletParadym.canTryUnlockingUsingBiometrics &&
    isBiometricsEnabled &&
    canUseBiometryBackedWalletKey

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

  const onCancel = useCallback(() => {
    if (isDcApiRequest) {
      sendCreateErrorResponse({
        errorMessage: errorReason ?? t(commonMessages.informationRequestDeclined),
      })
      return
    }

    exitWalletFlow()
  }, [errorReason, exitWalletFlow, isDcApiRequest, t])

  const onGoToWallet = useCallback(() => {
    if (isDcApiRequest) {
      sendCreateResponse({
        response: JSON.stringify({ protocol: 'openid4vci', data: {} }),
      })
      return
    }

    exitWalletFlow()
  }, [exitWalletFlow, isDcApiRequest])

  useEffect(() => {
    paradym.openid4vc
      .resolveCredentialOffer({
        offerUri: params.uri,
        authorization: activeWalletClient,
        onProgress: setLoadingStage,
      })
      .then(setResolvedCredentialOffer)
      .catch((error) => {
        paradym.logger.error(`Couldn't resolve OpenID4VCI offer`, { error })
        setErrorReasonWithError(t(commonMessages.credentialInformationCouldNotBeExtracted), error)
      })
      .finally(() => setLoadingStage(undefined))
  }, [activeWalletClient, paradym, params.uri, setErrorReasonWithError, t])

  useEffect(() => {
    if (
      didUnlockForRequest(params[requestAuthAfterUnlockParam]) ||
      didOpenRequestWhileUnlocked(params[requestOpenedWhileUnlockedParam])
    ) {
      return
    }

    onMarkRequestOpenedWhileUnlocked?.()
  }, [onMarkRequestOpenedWhileUnlocked, params])

  useEffect(() => {
    if (!resolvedCredentialOffer) return

    pinRef.current?.clear()
    setPresentationStage('review')
  }, [resolvedCredentialOffer])

  const updateCredentials = useCallback(
    (options: { deferredCredentials: DeferredCredentialBefore[]; credentials: CredentialForDisplay[] }) => {
      if (options.deferredCredentials.length > 0 && options.credentials.length > 0) {
        setErrorReasonWithError(
          t(commonMessages.credentialInformationCouldNotBeExtracted),
          new Error('Received both immediate and deferred credentials')
        )
        paradym.logger.error('Received both immediate and deferred credentials in OpenID4VCI response')
        return
      }

      if (options.deferredCredentials.length) {
        setDeferredCredential(options.deferredCredentials[0])
      }

      if (options.credentials.length) {
        setReceivedCredential(options.credentials[0])
      }
    },
    [paradym, setErrorReasonWithError, t]
  )

  const completeCredentialRetrieval = useCallback(
    async (options: { deferredCredentials: DeferredCredentialBefore[]; credentials: CredentialForDisplay[] }) => {
      const nextDeferredCredential = options.deferredCredentials[0]
      const nextReceivedCredential = options.credentials[0]

      await paradym.openid4vc.completeCredentialRetrieval({
        resolvedCredentialOffer: resolvedCredentialOffer?.resolvedCredentialOffer,
        recordToStore: nextReceivedCredential
          ? dcApiRegisterOptions({ paradym, credentialRecord: nextReceivedCredential.record })
          : undefined,
        deferredCredential: nextDeferredCredential,
      })

      if (isDcApiRequest) {
        sendCreateResponse({
          response: JSON.stringify({ protocol: 'openid4vci', data: {} }),
          newEntryId: nextReceivedCredential ? getCredentialForDisplayId(nextReceivedCredential.record) : undefined,
        })
        return
      }

      if (params.source === 'deeplink') {
        exitWalletFlow()
        return
      }

      setIsCompleted(true)
    },
    [exitWalletFlow, isDcApiRequest, paradym, params.source, resolvedCredentialOffer]
  )

  const acquireCredentialsAuth = useCallback(
    async (authorizationCode: string) => {
      if (!resolvedCredentialOffer || resolvedCredentialOffer.flow !== 'auth') return false

      setIsBusy(true)
      try {
        const acquiredCredentials = await paradym.openid4vc.acquireCredentials({
          resolvedCredentialOffer: resolvedCredentialOffer.resolvedCredentialOffer,
          resolvedAuthorizationRequest: resolvedCredentialOffer.resolvedAuthorizationRequest,
          authorizationCode,
          authorization: activeWalletClient,
        })

        updateCredentials(acquiredCredentials)
        await completeCredentialRetrieval(acquiredCredentials)
        return true
      } catch (error) {
        paradym.logger.error(`Couldn't receive credential from OpenID4VCI offer`, { error })
        setErrorReasonWithError(t(commonMessages.errorWhileRetrievingCredentials), error)
        return false
      } finally {
        setIsBusy(false)
      }
    },
    [activeWalletClient, completeCredentialRetrieval, paradym, resolvedCredentialOffer, setErrorReasonWithError, t, updateCredentials]
  )

  const openAuthSession = useCallback(async () => {
    if (!resolvedCredentialOffer || resolvedCredentialOffer.flow !== 'auth') return

    setIsBusy(true)
    try {
      const result = await WebBrowser.openAuthSessionAsync(
        resolvedCredentialOffer.resolvedAuthorizationRequest.authorizationRequestUrl,
        activeWalletClient.redirectUri
      )
      setBrowserResult(result)
    } finally {
      setIsBusy(false)
    }
  }, [activeWalletClient.redirectUri, resolvedCredentialOffer])

  const acquireCredentialsPreAuth = useCallback(
    async (txCode?: string) => {
      if (!resolvedCredentialOffer) return
      if (resolvedCredentialOffer.flow !== 'pre-auth' && resolvedCredentialOffer.flow !== 'pre-auth-with-tx-code')
        return

      if (resolvedCredentialOffer.flow === 'pre-auth-with-tx-code' && !txCode) return

      setIsBusy(true)
      try {
        const acquiredCredentials = await paradym.openid4vc.acquireCredentials({
          resolvedCredentialOffer: resolvedCredentialOffer.resolvedCredentialOffer,
          transactionCode: txCode,
        })

        updateCredentials(acquiredCredentials)
        await completeCredentialRetrieval(acquiredCredentials)
      } catch (error) {
        paradym.logger.error(`Couldn't receive credential from OpenID4VCI offer`, { error })
        setErrorReasonWithError(t(commonMessages.errorWhileRetrievingCredentials), error)
      } finally {
        setIsBusy(false)
      }
    },
    [completeCredentialRetrieval, paradym, resolvedCredentialOffer, setErrorReasonWithError, t, updateCredentials]
  )

  const onPresentationAccept = useCallback(
    async (pin?: string, options?: { didUseBiometrics?: boolean }) => {
      if (!resolvedCredentialOffer || resolvedCredentialOffer.flow !== 'auth-presentation-during-issuance') {
        setErrorReason(t(commonMessages.presentationInformationCouldNotBeExtracted))
        return
      }

      setIsBusy(true)
      try {
        if (needsPresentationWalletAuth && !options?.didUseBiometrics) {
          if (!pin) {
            setErrorReason('PIN is required to accept the presentation.')
            return
          }

          await setWalletServiceProviderPinFromString(pin)
        }

        const acquiredCredentials = await paradym.openid4vc.acquireCredentials({
          authorization: activeWalletClient,
          resolvedCredentialOffer: resolvedCredentialOffer.resolvedCredentialOffer,
          resolvedAuthorizationRequest: resolvedCredentialOffer.resolvedAuthorizationRequest,
          credentialsForRequest: resolvedCredentialOffer.credentialsForProofRequest,
        })

        updateCredentials(acquiredCredentials)
        await completeCredentialRetrieval(acquiredCredentials)
      } catch (error) {
        if (error instanceof ParadymWalletBiometricAuthenticationCancelledError) {
          return
        }

        if (error instanceof ParadymWalletAuthenticationInvalidPinError) {
          pinRef.current?.clear()
          pinRef.current?.shake()
          toast.show(t(commonMessages.invalidPinEntered), { customData: { preset: 'warning' } })
          return
        }

        paradym.logger.error('Error accepting presentation', { error })
        setErrorReasonWithError(t(commonMessages.presentationCouldNotBeShared), error)
      } finally {
        setIsBusy(false)
      }
    },
    [
      activeWalletClient,
      paradym,
      pinRef,
      resolvedCredentialOffer,
      needsPresentationWalletAuth,
      setErrorReasonWithError,
      t,
      toast,
      updateCredentials,
      completeCredentialRetrieval,
    ]
  )

  const onBiometricsTap = useCallback(() => {
    if (!canRequestPresentationBiometrics) return

    setIsBusy(true)
    void walletParadym
      .tryUnlockingUsingBiometrics()
      .then(async () => {
        await onPresentationAccept(undefined, { didUseBiometrics: true })
      })
      .catch((error) => {
        if (error instanceof ParadymWalletBiometricAuthenticationCancelledError) return

        paradym.logger.error('Biometric authentication failed during issuance presentation', { error })
        setErrorReasonWithError(t(commonMessages.presentationCouldNotBeShared), error)
      })
      .finally(() => {
        setIsBusy(false)
      })
  }, [canRequestPresentationBiometrics, onPresentationAccept, paradym, setErrorReasonWithError, t, walletParadym])

  useEffect(() => {
    if (presentationStage !== 'auth') {
      hasAttemptedPresentationBiometricsRef.current = false
      return
    }

    if (!canRequestPresentationBiometrics || hasAttemptedPresentationBiometricsRef.current || isBusy) return

    hasAttemptedPresentationBiometricsRef.current = true
    onBiometricsTap()
  }, [canRequestPresentationBiometrics, isBusy, onBiometricsTap, presentationStage])

  useEffect(() => {
    if (handledAuthResult || !resolvedCredentialOffer) return

    if (credentialAuthorizationCode) {
      if (Platform.OS === 'ios') {
        WebBrowser.dismissAuthSession()
      }

      void acquireCredentialsAuth(credentialAuthorizationCode).finally(() => {
        setHandledAuthResult(true)
      })
      return
    }

    if (credentialAuthorizationError) {
      if (Platform.OS === 'ios') {
        WebBrowser.dismissAuthSession()
      }

      setHandledAuthResult(true)

      const descriptionSuffix = credentialAuthorizationErrorDescription
        ? `\n\n${credentialAuthorizationErrorDescription}`
        : ''

      if (credentialAuthorizationError === 'access_denied') {
        onCancel()
        return
      }

      setErrorReason(t(commonMessages.authorizationFailed) + descriptionSuffix)
      return
    }

    if (!browserResult) return

    setHandledAuthResult(true)

    if (browserResult.type !== 'success') {
      const developmentMessage =
        isDevelopmentModeEnabled && browserResult.type
          ? `\n\nDevelopment mode error:\nBrowser result returned '${browserResult.type}' result.`
          : ''
      browserResult.type === 'cancel' || browserResult.type === 'dismiss'
        ? onCancel()
        : setErrorReason(t(commonMessages.authorizationFailed) + developmentMessage)
      return
    }

    const authorizationCode = new URL(browserResult.url).searchParams.get('code')
    if (!authorizationCode) {
      const developmentMessage = isDevelopmentModeEnabled
        ? `\n\nDevelopment mode error:\nMissing authorization code in url ${browserResult.url}`
        : ''
      setErrorReason(t(commonMessages.authorizationFailed) + developmentMessage)
      return
    }

    void acquireCredentialsAuth(authorizationCode)
  }, [
    acquireCredentialsAuth,
    browserResult,
    credentialAuthorizationCode,
    credentialAuthorizationError,
    credentialAuthorizationErrorDescription,
    handledAuthResult,
    resolvedCredentialOffer,
    isDevelopmentModeEnabled,
    onCancel,
    t,
  ])

  const offer = resolvedCredentialOffer
  const logo = offer?.credentialDisplay.issuer.logo
  const issuerName = offer?.credentialDisplay.issuer.name ?? params.uri
  const isAcceptingCredential = isBusy && !isCompleted

  const footer = !offer ? (
    <Button.Outline onPress={onCancel}>{t(commonMessages.stop)}</Button.Outline>
  ) : isCompleted ? (
    <Button.Solid onPress={onGoToWallet} disabled={isBusy}>
      {t(commonMessages.goToWallet)} <HeroIcons.ArrowRight size={20} color="$white" />
    </Button.Solid>
  ) : offer.flow === 'auth' ? (
    <XStack gap="$3">
      <Button.Outline flex={1} onPress={onCancel} disabled={isBusy}>
        {t(commonMessages.stop)}
      </Button.Outline>
      <Button.Solid flex={1} onPress={() => void openAuthSession()} disabled={isBusy}>
        {t({
          id: 'receiveCredential.authenticate',
          message: 'Authenticate',
          comment: 'Button label to start issuer authentication',
        })}
      </Button.Solid>
    </XStack>
  ) : offer.flow === 'pre-auth-with-tx-code' ? (
    <XStack gap="$3">
      <Button.Outline flex={1} onPress={onCancel} disabled={isBusy}>
        {t(commonMessages.stop)}
      </Button.Outline>
      <Button.Solid
        flex={1}
        onPress={() => void acquireCredentialsPreAuth(txCodeEntry)}
        disabled={isBusy || (offer.txCodeInfo.length !== undefined && txCodeEntry.length !== offer.txCodeInfo.length)}
      >
        {t(commonMessages.acceptButton)}
      </Button.Solid>
    </XStack>
  ) : offer.flow === 'pre-auth' ? (
    <XStack gap="$3">
      <Button.Outline flex={1} onPress={onCancel} disabled={isBusy}>
        {t(commonMessages.stop)}
      </Button.Outline>
      <Button.Solid flex={1} onPress={() => void acquireCredentialsPreAuth()} disabled={isBusy}>
        {t(commonMessages.acceptButton)}
      </Button.Solid>
    </XStack>
  ) : offer.flow === 'auth-presentation-during-issuance' ? (
    presentationStage === 'auth' ? (
      <Button.Outline
        onPress={() => {
          pinRef.current?.clear()
          setPresentationStage('review')
        }}
        disabled={isBusy}
      >
        {t(commonMessages.backButton)}
      </Button.Outline>
    ) : (
      <XStack gap="$3">
        <Button.Outline flex={1} onPress={onCancel} disabled={isBusy}>
          {t(commonMessages.stop)}
        </Button.Outline>
        <Button.Solid
          flex={1}
          onPress={() => {
            if (needsPresentationWalletAuth) {
              setPresentationStage('auth')
              return
            }

            void onPresentationAccept()
          }}
          disabled={isBusy}
        >
          {t(commonMessages.acceptButton)}
        </Button.Solid>
      </XStack>
    )
  ) : (
    <Button.Solid onPress={onCancel}>{t(commonMessages.close)}</Button.Solid>
  )

  if (errorReason) {
    return (
      <FlowSurface
        surface={surface}
        sheetVariant={isOverlay ? 'docked' : undefined}
        footer={<Button.Solid onPress={onCancel}>{t(commonMessages.close)}</Button.Solid>}
      >
        <YStack flex={1} gap="$6" justifyContent="center">
          <ConsentErrorState
            title={t({
              id: 'receiveCredential.errorTitle',
              message: 'Something went wrong',
              comment: 'Title shown when the issuance flow cannot continue',
            })}
            description={errorReason}
          />
        </YStack>
      </FlowSurface>
    )
  }

  if (!offer) {
    const loadingCopy = getIssuanceLoadingCopy(t, loadingStage)

    return (
      <FlowSurface
        surface={surface}
        sheetVariant={isOverlay ? 'docked' : undefined}
        footer={<Button.Outline onPress={onCancel}>{t(commonMessages.stop)}</Button.Outline>}
      >
        <YStack flex={1} gap="$4" jc="center">
          <ConsentLoadingSection title={loadingCopy.title} description={loadingCopy.description} />
        </YStack>
      </FlowSurface>
    )
  }

  if (isCompleted) {
    return (
      <FlowSurface
        surface={surface}
        sheetVariant={isOverlay ? 'docked' : undefined}
        footer={
          <Button.Solid onPress={onGoToWallet}>
            {t(commonMessages.goToWallet)} <HeroIcons.ArrowRight size={20} color="$white" />
          </Button.Solid>
        }
      >
        <YStack flex={1} gap="$6" justifyContent="center">
          <YStack gap="$4" ai="center">
            <Stack width={72} height={72} br="$6" bg="$primary-50" ai="center" jc="center">
              <HeroIcons.ShieldCheckFilled color="$primary-500" size={32} />
            </Stack>
            <Heading ta="center">
              {deferredCredential
                ? t({
                    id: 'receiveCredential.deferredCredentialHeader',
                    message: 'Card is not ready yet',
                    comment: 'Heading shown when the issuer will provide the credential later',
                  })
                : t({
                    id: 'receiveCredential.successHeader',
                    message: 'Success!',
                    comment: 'Heading shown once the credential has been stored successfully',
                  })}
            </Heading>
            <Paragraph ta="center" color="$grey-600">
              {deferredCredential
                ? t({
                    id: 'retrieveCredential.cardPending',
                    message: 'The card will be fetched once available.',
                    comment: 'Shown when the issuer will provide the credential later',
                  })
                : t({
                    id: 'retrieveCredential.cardSuccessfully added',
                    message: 'Card successfully added to your wallet!',
                    comment: 'Shown once the credential has been stored successfully',
                  })}
            </Paragraph>
          </YStack>

          <ConsentCredentialPreview credentialDisplay={offer.credentialDisplay} />
        </YStack>
      </FlowSurface>
    )
  }

  return (
    <FlowSurface
      surface={surface}
      sheetVariant={isOverlay ? 'docked' : undefined}
      logo={isOverlay ? logo : undefined}
      footer={footer}
      header={
        <YStack gap="$3">
          <ConsentPartyHeader
            hideLogo={isOverlay}
            logo={logo}
            title={
              offer.flow === 'auth-presentation-during-issuance' && presentationStage === 'auth'
                ? t({
                    id: 'receiveCredential.presentationHeading',
                    message: 'Confirm with PIN or biometrics',
                    comment: 'Heading shown when the issuance flow requires wallet confirmation',
                  })
                : (offer.credentialDisplay.name ??
                  t({
                    id: 'receiveCredential.title',
                    message: 'Add credential',
                    comment: 'Title shown on the issuance screen',
                  }))
            }
            subtitle={issuerName}
          />
          <Paragraph color="$grey-700">
            {offer.flow === 'auth-presentation-during-issuance' && presentationStage === 'auth'
              ? t({
                  id: 'receiveCredential.presentationInstructions',
                  message: 'Approve this issuance with your app PIN or biometrics.',
                  comment: 'Instructions shown on the issuance auth step',
                })
              : offer.flow === 'auth'
                ? t({
                    id: 'receiveCredential.authDescription',
                    message: 'Authenticate with the issuer to continue.',
                    comment: 'Description shown for auth-code issuance offers',
                  })
                : offer.flow === 'pre-auth-with-tx-code'
                  ? t({
                      id: 'receiveCredential.txCodeDescription',
                      message: 'Enter the transaction code provided by the issuer.',
                      comment: 'Description shown for transaction code issuance offers',
                    })
                  : offer.flow === 'auth-presentation-during-issuance'
                    ? t({
                        id: 'receiveCredential.presentationDescription',
                        message: 'Review the issuer request before you confirm the issuance.',
                        comment: 'Description shown for issuance offers that require a presentation',
                      })
                    : t({
                        id: 'receiveCredential.reviewDescription',
                        message: 'Review the issuer request before you confirm it.',
                        comment: 'Default issuance description',
                      })}
          </Paragraph>
        </YStack>
      }
    >
      <ScrollView contentContainerStyle={{ gap: '$6', flexGrow: 1 }} scrollIndicatorInsets={{ right: 1 }}>
        <YStack gap="$5">
          <ConsentCredentialPreview credentialDisplay={offer.credentialDisplay} />

          {isAcceptingCredential ? (
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
          ) : null}

          {!isAcceptingCredential && offer.flow === 'pre-auth-with-tx-code' ? (
            <ConsentSection
              title={t({
                id: 'receiveCredential.txCodeHeading',
                message: 'Enter transaction code',
                comment: 'Heading shown for a transaction code input',
              })}
              description={
                offer.txCodeInfo.description ??
                t({
                  id: 'receiveCredential.txCodeInstructions',
                  message:
                    'To receive this card you need to enter a transaction code. This code has been provided to you by the issuer.',
                  comment: 'Instructions explaining why the user must enter a transaction code',
                })
              }
            >
              <Input
                secureTextEntry
                autoFocus
                value={txCodeEntry}
                onChangeText={(event) => {
                  const value = typeof event === 'string' ? event : event.nativeEvent.text
                  setTxCodeEntry(value)
                  if (offer.txCodeInfo.length !== undefined && value.length === offer.txCodeInfo.length) {
                    void acquireCredentialsPreAuth(value)
                  }
                }}
                keyboardType={offer.txCodeInfo.input_mode === 'text' ? 'ascii-capable' : 'numeric'}
                maxLength={offer.txCodeInfo.length}
                placeholderTextColor="$grey-500"
                borderColor="$grey-300"
                size="$4"
              />
            </ConsentSection>
          ) : null}

          {!isAcceptingCredential &&
          offer.flow === 'auth-presentation-during-issuance' &&
          presentationStage === 'auth' ? (
            needsPresentationWalletAuth ? (
              <ConsentAuthSection
                title={t({
                  id: 'receiveCredential.presentationHeading',
                  message: 'Confirm with PIN or biometrics',
                  comment: 'Heading shown for the presentation during issuance',
                })}
                description={t({
                  id: 'receiveCredential.presentationInstructions',
                  message: 'Approve this issuance with your app PIN or biometrics.',
                  comment: 'Instructions shown for the presentation during issuance',
                })}
                pinRef={pinRef}
                onPinComplete={(pin) => {
                  void onPresentationAccept(pin)
                }}
                onBiometricsTap={canRequestPresentationBiometrics ? onBiometricsTap : undefined}
                biometricsType={biometricsType ?? 'fingerprint'}
                isLoading={isBusy}
              />
            ) : null
          ) : null}

          {!isAcceptingCredential && offer.flow === 'auth' ? (
            <ConsentSection
              title={t({
                id: 'receiveCredential.authHeading',
                message: 'Verify your account',
                comment: 'Heading shown for auth-code issuance offers',
              })}
              description={t({
                id: 'receiveCredential.authInstructions',
                message:
                  'To receive this card, you need to authorize with your account. You will now be redirected to the issuer website.',
                comment: 'Instructions shown for auth-code issuance offers',
              })}
            />
          ) : null}
        </YStack>
      </ScrollView>
    </FlowSurface>
  )
}
