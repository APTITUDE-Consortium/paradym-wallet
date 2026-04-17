import { TypedArrayEncoder } from '@credo-ts/core'
import { useBiometricsType } from '@easypid/hooks/useBiometricsType'
import { useLingui } from '@lingui/react/macro'
import { PinDotsInput, type PinDotsInputRef } from '@package/app'
import { commonMessages } from '@package/translations'
import { FlexPage, FlowSurface, Heading, HeroIcons, IconContainer, useDeviceMedia, useToastController, YStack } from '@package/ui'
import {
  ParadymWalletAuthenticationInvalidPinError,
  ParadymWalletBiometricAuthenticationError,
  useCanUseBiometryBackedWalletKey,
  useIsBiometricsEnabled,
  useParadym,
} from '@paradym/wallet-sdk'
import { Redirect, useLocalSearchParams } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useRef, useState } from 'react'
import { setWalletServiceProviderPinFromString } from '../crypto/WalletServiceProviderClient'
import { useResetWalletDevMenu } from '../hooks/useResetWalletDevMenu'
import { ConsentLoadingSection } from '../features/consent/ConsentBlocks'

type AuthenticateScreenProps = {
  surface?: 'fullscreen' | 'sheet'
  onUnlocked?: (redirect: string) => void
  redirectAfterUnlockOverride?: string
}

/**
 * Authenticate screen is redirect to from app layout when app is configured but locked
 */
export function AuthenticateScreen({
  surface = 'fullscreen',
  onUnlocked,
  redirectAfterUnlockOverride,
}: AuthenticateScreenProps) {
  useResetWalletDevMenu()
  const { t } = useLingui()

  const paradym = useParadym()

  const { redirectAfterUnlock } = useLocalSearchParams<{ redirectAfterUnlock?: string }>()
  const toast = useToastController()
  const biometricsType = useBiometricsType()
  const pinInputRef = useRef<PinDotsInputRef>(null)
  const hasAttemptedAutoBiometricsRef = useRef(false)
  const hasHandledUnlockedRef = useRef(false)
  const { additionalPadding, noBottomSafeArea } = useDeviceMedia()
  const [isInitializingAgent, setIsInitializingAgent] = useState(false)
  const [isBiometricsEnabled] = useIsBiometricsEnabled()
  const canUseBiometryBackedWalletKey = useCanUseBiometryBackedWalletKey()
  const [shouldPromptBiometrics, setShouldPromptBiometrics] = useState(true)
  const [unlockStage, setUnlockStage] = useState<'authenticating' | 'opening-wallet'>('authenticating')
  const resolvedRedirectAfterUnlock = redirectAfterUnlockOverride ?? redirectAfterUnlock
  const decodedRedirectAfterUnlock =
    typeof resolvedRedirectAfterUnlock === 'string'
      ? (() => {
          try {
            return TypedArrayEncoder.toUtf8String(TypedArrayEncoder.fromBase64(resolvedRedirectAfterUnlock))
          } catch {
            return undefined
          }
        })()
      : undefined
  const isOverlay = surface === 'sheet'
  const canAutoPromptBiometrics = paradym.state === 'locked' ? paradym.canTryUnlockingUsingBiometrics : false

  const isLoading =
    paradym.state === 'acquired-wallet-key' || isInitializingAgent || (paradym.state === 'locked' && paradym.isUnlocking)

  useEffect(() => {
    if (paradym.state !== 'locked') {
      hasAttemptedAutoBiometricsRef.current = false
      return
    }

    if (!canAutoPromptBiometrics || !shouldPromptBiometrics || hasAttemptedAutoBiometricsRef.current) {
      return
    }

    hasAttemptedAutoBiometricsRef.current = true
    setUnlockStage('authenticating')
    void paradym.tryUnlockingUsingBiometrics()
  }, [canAutoPromptBiometrics, paradym, paradym.state, shouldPromptBiometrics])

  useEffect(() => {
    if (isInitializingAgent || paradym.state !== 'acquired-wallet-key') return

    setUnlockStage('opening-wallet')
    setIsInitializingAgent(true)
    paradym
      .unlock()
      .catch((error) => {
        if (
          error instanceof ParadymWalletAuthenticationInvalidPinError ||
          error instanceof ParadymWalletBiometricAuthenticationError
        ) {
          pinInputRef.current?.clear()
          pinInputRef.current?.shake()
        }
        if (error instanceof ParadymWalletAuthenticationInvalidPinError) {
          // We do not want to prompt biometrics directly after an incorrect pin input
          setShouldPromptBiometrics(false)
        }
        setUnlockStage('authenticating')
      })
      .finally(() => setIsInitializingAgent(false))
  }, [paradym, isInitializingAgent])

  useEffect(() => {
    if (paradym.state !== 'unlocked') {
      hasHandledUnlockedRef.current = false
      return
    }

    if (!onUnlocked || hasHandledUnlockedRef.current) return

    hasHandledUnlockedRef.current = true
    onUnlocked(decodedRedirectAfterUnlock ?? '/')
  }, [decodedRedirectAfterUnlock, onUnlocked, paradym.state])

  if (paradym.state === 'unlocked') {
    // Expo and urls as query params don't go well together, so we encoded the url as base64
    const redirect = decodedRedirectAfterUnlock ?? '/'

    if (onUnlocked) {
      return null
    }

    return <Redirect href={redirect} />
  }

  if (paradym.state === 'initializing') {
    return null
  }

  if (paradym.state === 'not-configured') {
    return <Redirect href="/" />
  }

  void SplashScreen.hideAsync()

  const unlockUsingBiometrics = async () => {
    if (paradym.state === 'locked') {
      setUnlockStage('authenticating')
      await paradym.tryUnlockingUsingBiometrics()
    } else {
      toast.show(t({ id: 'authenticate.pinRequiredToast', message: 'Your PIN is required to unlock the app' }), {
        customData: {
          preset: 'danger',
        },
      })
    }
  }

  const unlockUsingPin = async (pin: string) => {
    if (paradym.state !== 'locked') return
    setUnlockStage('authenticating')
    await paradym.unlockUsingPin(pin)
    await setWalletServiceProviderPinFromString(pin, false)
  }

  const loadingDescription =
    unlockStage === 'opening-wallet'
      ? t({
          id: 'authenticate.loadingDescriptionOpeningWallet',
          message: 'Opening your wallet.',
          comment: 'Description shown while the wallet agent is opening after successful authentication',
        })
      : t({
          id: 'authenticate.loadingDescriptionAuthenticating',
          message: 'Checking your PIN or biometrics.',
          comment: 'Description shown while the wallet checks the submitted PIN or biometric prompt',
        })

  const content = isLoading ? (
    <ConsentLoadingSection
      title={t({
        id: 'authenticate.loadingTitle',
        message: 'Please wait',
        comment: 'Title shown while the wallet finishes unlocking after successful authentication',
      })}
      description={loadingDescription}
    />
  ) : (
    <YStack
      fg={isOverlay ? undefined : 1}
      gap="$6"
      pt={isOverlay ? '$2' : undefined}
      mb={isOverlay ? undefined : noBottomSafeArea ? -additionalPadding : undefined}
    >
      <YStack flex={isOverlay ? undefined : 1} alignItems="center" justifyContent={isOverlay ? undefined : 'flex-end'} gap="$4">
        <IconContainer h="$4" w="$4" ai="center" jc="center" icon={<HeroIcons.LockClosedFilled />} />
        <Heading heading="h2" fontWeight="$semiBold">
          {t(commonMessages.enterPin)}
        </Heading>
      </YStack>
      <PinDotsInput
        isLoading={isLoading}
        ref={pinInputRef}
        pinLength={6}
        onPinComplete={unlockUsingPin}
        onBiometricsTap={isBiometricsEnabled && canUseBiometryBackedWalletKey ? unlockUsingBiometrics : undefined}
        useNativeKeyboard={false}
        biometricsType={biometricsType ?? 'fingerprint'}
      />
    </YStack>
  )

  if (isOverlay) {
    return (
      <FlowSurface surface="sheet" sheetVariant="docked">
        {content}
      </FlowSurface>
    )
  }

  return (
    <FlexPage flex={1} alignItems="center">
      {content}
    </FlexPage>
  )
}

export default function Authenticate() {
  return <AuthenticateScreen />
}
