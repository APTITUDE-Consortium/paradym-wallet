import { TypedArrayEncoder } from '@credo-ts/core'
import { initializeAppAgent, useSecureUnlock } from '@easypid/agent'
import { useLingui } from '@lingui/react/macro'
import { PinDotsInput, type PinDotsInputRef } from '@package/app'
import { secureWalletKey, useBiometricUnlockState } from '@package/secure-store/secureUnlock'
import { commonMessages } from '@package/translations'
import { FlexPage, Heading, HeroIcons, IconContainer, useDeviceMedia, useToastController, YStack } from '@package/ui'
import { Redirect, useLocalSearchParams } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useRef, useState } from 'react'
import { InvalidPinError } from '../crypto/error'
import { useResetWalletDevMenu } from '../utils/resetWallet'

/**
 * Authenticate screen is redirect to from app layout when app is configured but locked
 */
export default function Authenticate() {
  useResetWalletDevMenu()

  const { redirectAfterUnlock } = useLocalSearchParams<{ redirectAfterUnlock?: string }>()
  const toast = useToastController()
  const secureUnlock = useSecureUnlock()
  const pinInputRef = useRef<PinDotsInputRef>(null)
  const hasAttemptedAutoBiometricsRef = useRef(false)
  const { additionalPadding, noBottomSafeArea } = useDeviceMedia()
  const [isInitializingAgent, setIsInitializingAgent] = useState(false)
  const [isAllowedToUnlockWithFaceId, setIsAllowedToUnlockWithFaceId] = useState(false)
  const [shouldPromptBiometrics, setShouldPromptBiometrics] = useState(true)
  const { t } = useLingui()
  const biometricUnlockState = useBiometricUnlockState()
  const biometricsType =
    biometricUnlockState.data?.biometryType?.toLowerCase().includes('face') ||
    biometricUnlockState.data?.biometryType?.toLowerCase().includes('optic')
      ? 'face'
      : 'fingerprint'
  const showBiometricUnlockAction =
    biometricUnlockState.data?.canUnlockNow === true &&
    (secureUnlock.state === 'locked' ||
      (secureUnlock.state === 'acquired-wallet-key' && secureUnlock.unlockMethod === 'biometrics'))
  const canAutoPromptBiometricUnlock =
    biometricUnlockState.data?.canUnlockNow === true &&
    secureUnlock.state === 'locked' &&
    secureUnlock.canTryUnlockingUsingBiometrics

  const isLoading =
    secureUnlock.state === 'acquired-wallet-key' ||
    (secureUnlock.state === 'locked' && secureUnlock.isUnlocking) ||
    isInitializingAgent

  useEffect(() => {
    if (secureUnlock.state === 'unlocked' && redirectAfterUnlock) {
      secureUnlock.lock()
    }
  }, [])

  // After resetting the wallet, we want to avoid prompting for face id immediately
  // So we add an artificial delay
  useEffect(() => {
    const timer = setTimeout(() => setIsAllowedToUnlockWithFaceId(true), 500)

    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (secureUnlock.state !== 'locked') {
      hasAttemptedAutoBiometricsRef.current = false
      return
    }

    if (
      !canAutoPromptBiometricUnlock ||
      !isAllowedToUnlockWithFaceId ||
      !shouldPromptBiometrics ||
      hasAttemptedAutoBiometricsRef.current
    ) {
      return
    }

    hasAttemptedAutoBiometricsRef.current = true
    void secureUnlock.tryUnlockingUsingBiometrics()
  }, [
    canAutoPromptBiometricUnlock,
    isAllowedToUnlockWithFaceId,
    secureUnlock,
    secureUnlock.state,
    shouldPromptBiometrics,
  ])

  useEffect(() => {
    if (secureUnlock.state !== 'acquired-wallet-key') return
    if (isInitializingAgent) return

    setIsInitializingAgent(true)
    initializeAppAgent({
      walletKey: secureUnlock.walletKey,
      walletKeyVersion: secureWalletKey.getWalletKeyVersion(),
    })
      .then((agent) => secureUnlock.setWalletKeyValid({ agent }))
      .catch((error) => {
        if (error instanceof InvalidPinError) {
          secureUnlock.setWalletKeyInvalid()
          pinInputRef.current?.clear()
          pinInputRef.current?.shake()
          setShouldPromptBiometrics(false)
        }

        // TODO: handle other
        console.error(error)
      })
      .finally(() => {
        setIsInitializingAgent(false)
      })
  }, [secureUnlock, isInitializingAgent])

  if (secureUnlock.state === 'unlocked') {
    // Expo and urls as query params don't go well together, so we encoded the url as base64
    const redirect = redirectAfterUnlock
      ? TypedArrayEncoder.toUtf8String(TypedArrayEncoder.fromBase64(redirectAfterUnlock))
      : '/'

    return <Redirect href={redirect} />
  }

  if (secureUnlock.state === 'initializing' || secureUnlock.state === 'not-configured') {
    return <Redirect href="/" />
  }

  void SplashScreen.hideAsync()

  const unlockUsingBiometrics = async () => {
    if (secureUnlock.state === 'locked') {
      hasAttemptedAutoBiometricsRef.current = true
      setShouldPromptBiometrics(false)
      await secureUnlock.tryUnlockingUsingBiometrics()
    } else {
      toast.show(t({ id: 'authenticate.pinRequiredToast', message: 'Your PIN is required to unlock the app' }), {
        customData: {
          preset: 'danger',
        },
      })
    }
  }

  const unlockUsingPin = async (pin: string) => {
    if (secureUnlock.state !== 'locked') return
    await secureUnlock.unlockUsingPin(pin)
  }

  return (
    <FlexPage flex-1 alignItems="center">
      <YStack fg={1} gap="$6" mb={noBottomSafeArea ? -additionalPadding : undefined}>
        <YStack flex-1 alignItems="center" justifyContent="flex-end" gap="$4">
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
          onBiometricsTap={showBiometricUnlockAction ? unlockUsingBiometrics : undefined}
          useNativeKeyboard={false}
          biometricsType={biometricsType ?? 'fingerprint'}
        />
      </YStack>
    </FlexPage>
  )
}
