import { Trans } from '@lingui/react/macro'
import { type PinDotsInputRef, useWizard } from '@package/app'
import { secureWalletKey, useBiometricUnlockState } from '@package/secure-store/secureUnlock'
import { YStack } from '@package/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { WalletPinPromptHeader, WalletPinPromptInput } from '../../../components/WalletPinPrompt'

export interface onPinSubmitProps {
  pin?: string
  authMethod?: 'pin' | 'biometrics'
  onPinComplete?: () => void
  onPinError?: () => void
}

export interface PinSlideProps {
  onPinSubmit: (props: onPinSubmitProps) => Promise<void>
  isLoading: boolean
}

export const PinSlide = ({ onPinSubmit, isLoading }: PinSlideProps) => {
  const { onNext } = useWizard()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAllowedToAutoPromptBiometrics, setIsAllowedToAutoPromptBiometrics] = useState(false)
  const [shouldPromptBiometrics, setShouldPromptBiometrics] = useState(true)
  const pinRef = useRef<PinDotsInputRef>(null)
  const hasAttemptedAutoBiometricsRef = useRef(false)
  const biometricUnlockState = useBiometricUnlockState()
  const biometricsType =
    biometricUnlockState.data?.biometryType?.toLowerCase().includes('face') ||
    biometricUnlockState.data?.biometryType?.toLowerCase().includes('optic')
      ? 'face'
      : 'fingerprint'
  const showBiometricUnlockAction = biometricUnlockState.data?.canUnlockNow === true

  const onPinError = useCallback(() => {
    pinRef.current?.shake()
    pinRef.current?.clear()
  }, [])

  const onPinComplete = useCallback(() => onNext(), [onNext])

  const onPinEnterComplete = (pin: string) => {
    setIsSubmitting(true)

    onPinSubmit({
      pin,
      authMethod: 'pin',
      onPinComplete,
      onPinError,
    }).finally(() => setIsSubmitting(false))
  }

  const onBiometricsTap = useCallback(async () => {
    if (isLoading || isSubmitting) return

    hasAttemptedAutoBiometricsRef.current = true
    setShouldPromptBiometrics(false)
    setIsSubmitting(true)

    const walletKeyVersion = secureWalletKey.getWalletKeyVersion()
    const hasBiometricPin = await secureWalletKey.hasWalletPin(walletKeyVersion).catch(() => false)

    if (hasBiometricPin) {
      const pin = await secureWalletKey.getWalletPinUsingBiometrics(walletKeyVersion).catch(() => null)

      if (!pin) {
        onPinError()
        setIsSubmitting(false)
        return
      }

      onPinSubmit({
        pin,
        authMethod: 'biometrics',
        onPinComplete,
        onPinError,
      }).finally(() => setIsSubmitting(false))
      return
    }

    const walletKey = await secureWalletKey.getWalletKeyUsingBiometrics(walletKeyVersion).catch(() => null)

    if (!walletKey) {
      onPinError()
      setIsSubmitting(false)
      return
    }

    onPinSubmit({
      authMethod: 'biometrics',
      onPinComplete,
      onPinError,
    }).finally(() => setIsSubmitting(false))
  }, [isLoading, isSubmitting, onPinComplete, onPinError, onPinSubmit])

  useEffect(() => {
    const timer = setTimeout(() => setIsAllowedToAutoPromptBiometrics(true), 500)

    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (
      !showBiometricUnlockAction ||
      !isAllowedToAutoPromptBiometrics ||
      !shouldPromptBiometrics ||
      hasAttemptedAutoBiometricsRef.current
    ) {
      return
    }

    void onBiometricsTap()
  }, [isAllowedToAutoPromptBiometrics, onBiometricsTap, shouldPromptBiometrics, showBiometricUnlockAction])

  return (
    <YStack fg={1} jc="space-between">
      <YStack gap="$4">
        <WalletPinPromptHeader
          title={
            <Trans id="pinSlide.title" comment="Heading shown when user is asked to confirm a sharing request">
              Confirm data sharing
            </Trans>
          }
          subtitle={
            <Trans id="pinSlide.description" comment="Supporting text explaining how to confirm a sharing request">
              Use biometrics or your app PIN to confirm the request.
            </Trans>
          }
        />
      </YStack>
      <YStack fg={1} mt="$10">
        <WalletPinPromptInput
          onPinComplete={onPinEnterComplete}
          isLoading={isLoading || isSubmitting}
          inputRef={pinRef}
          onBiometricsTap={showBiometricUnlockAction ? onBiometricsTap : undefined}
          biometricsType={biometricsType}
        />
      </YStack>
    </YStack>
  )
}
