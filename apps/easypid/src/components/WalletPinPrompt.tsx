import { PinDotsInput, type PinDotsInputRef } from '@package/app'
import { secureWalletKey, useBiometricUnlockState } from '@package/secure-store/secureUnlock'
import { Heading, Paragraph, Stack } from '@package/ui'
import type { ReactNode, Ref } from 'react'
import { useCallback, useImperativeHandle, useRef } from 'react'

interface WalletPinPromptHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  annotation?: ReactNode
  headerIcon?: ReactNode
  headerAction?: ReactNode
  titleHeading?: 'h1' | 'h2'
  titleFontWeight?: string
  centerHeader?: boolean
}

interface WalletPinPromptInputProps {
  isLoading: boolean
  onPinComplete: (pin: string) => void
  inputRef?: Ref<PinDotsInputRef>
  onBiometricsTap?: () => void
  biometricsType?: 'face' | 'fingerprint'
  disableBiometrics?: boolean
}

export function WalletPinPromptHeader({
  title,
  subtitle,
  annotation,
  headerIcon,
  headerAction,
  titleHeading,
  titleFontWeight,
  centerHeader = false,
}: WalletPinPromptHeaderProps) {
  return (
    <>
      {headerIcon}
      {headerAction ? (
        <Stack w="100%" flexDirection="row" jc="space-between" ai="center">
          <Heading heading={titleHeading} fontWeight={titleFontWeight} flexShrink={1}>
            {title}
          </Heading>
          {headerAction}
        </Stack>
      ) : (
        <Heading heading={titleHeading} fontWeight={titleFontWeight}>
          {title}
        </Heading>
      )}
      {annotation ? <Paragraph variant="annotation">{annotation}</Paragraph> : null}
      {subtitle ? <Paragraph ta={centerHeader ? 'center' : undefined}>{subtitle}</Paragraph> : null}
    </>
  )
}

export function WalletPinPromptInput({
  isLoading,
  onPinComplete,
  inputRef,
  onBiometricsTap,
  biometricsType,
  disableBiometrics = false,
}: WalletPinPromptInputProps) {
  const biometricUnlockState = useBiometricUnlockState()
  const pinInputRef = useRef<PinDotsInputRef>(null)
  const shouldUseDefaultBiometrics =
    !disableBiometrics && !onBiometricsTap && biometricUnlockState.data?.canUnlockNow === true

  useImperativeHandle(
    inputRef,
    () => ({
      focus: () => pinInputRef.current?.focus(),
      clear: () => pinInputRef.current?.clear(),
      shake: () => pinInputRef.current?.shake(),
    }),
    []
  )

  const defaultBiometricsType =
    biometricUnlockState.data?.biometryType?.toLowerCase().includes('face') ||
    biometricUnlockState.data?.biometryType?.toLowerCase().includes('optic')
      ? 'face'
      : 'fingerprint'

  const onDefaultBiometricsTap = useCallback(async () => {
    const pin = await secureWalletKey
      .getWalletPinUsingBiometrics(secureWalletKey.getWalletKeyVersion())
      .catch(() => null)
    if (pin) {
      onPinComplete(pin)
    } else {
      pinInputRef.current?.shake()
    }
  }, [onPinComplete])

  const resolvedOnBiometricsTap = onBiometricsTap ?? (shouldUseDefaultBiometrics ? onDefaultBiometricsTap : undefined)

  return (
    <PinDotsInput
      onPinComplete={onPinComplete}
      isLoading={isLoading}
      pinLength={6}
      ref={pinInputRef}
      useNativeKeyboard={false}
      onBiometricsTap={resolvedOnBiometricsTap}
      biometricsType={biometricsType ?? defaultBiometricsType}
    />
  )
}
