import { commonMessages } from '@package/translations'
import { PinDotsIndicator, PinDotsInput, type PinDotsInputRef } from '@package/app'
import { Heading, HeroIcons, Image, MiniCardRowItem, Paragraph, Stack, XStack, YStack } from '@package/ui'
import type { CredentialDisplay, DisplayImage } from '@paradym/wallet-sdk'
import { useLingui } from '@lingui/react/macro'
import type { ReactNode, RefObject } from 'react'

type Tone = 'neutral' | 'danger'

const sectionToneStyles: Record<Tone, { bg: string; borderColor: string; titleColor?: string; bodyColor: string }> = {
  neutral: {
    bg: '$grey-50',
    borderColor: '$grey-100',
    bodyColor: '$grey-700',
  },
  danger: {
    bg: '$danger-50',
    borderColor: '$danger-100',
    titleColor: '$danger-600',
    bodyColor: '$danger-700',
  },
}

function ConsentLogo({ logo }: { logo?: DisplayImage }) {
  if (!logo?.url) {
    return (
      <Stack width={44} height={44} br="$6" bg="$grey-50" bw={1} borderColor="$grey-100" ai="center" jc="center">
        <HeroIcons.BuildingOffice color="$grey-700" size={28} />
      </Stack>
    )
  }

  return <Image src={logo.url} alt={logo.altText} contentFit="contain" width={44} height={44} />
}

export function ConsentPartyHeader({
  hideLogo = false,
  logo,
  title,
  subtitle,
  badgeLabel,
}: {
  hideLogo?: boolean
  logo?: DisplayImage
  title: ReactNode
  subtitle?: ReactNode
  badgeLabel?: ReactNode
}) {
  return (
    <XStack ai="center" gap="$3">
      {!hideLogo ? <ConsentLogo logo={logo} /> : null}
      <YStack flex={1}>
        <Heading heading="h2" numberOfLines={2}>
          {title}
        </Heading>
        {subtitle ? (
          <Paragraph variant="annotation" color="$grey-600" numberOfLines={2}>
            {subtitle}
          </Paragraph>
        ) : null}
        {badgeLabel ? (
          <XStack
            ai="center"
            alignSelf="flex-start"
            mt="$2"
            px="$2.5"
            py="$1"
            br="$10"
            bg="$grey-100"
            bw={1}
            borderColor="$grey-200"
          >
            <Paragraph variant="annotation" color="$grey-700" numberOfLines={1}>
              {badgeLabel}
            </Paragraph>
          </XStack>
        ) : null}
      </YStack>
    </XStack>
  )
}

export function ConsentSection({
  tone = 'neutral',
  eyebrow,
  title,
  description,
  children,
}: {
  tone?: Tone
  eyebrow?: ReactNode
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
}) {
  const styles = sectionToneStyles[tone]

  return (
    <YStack gap="$3" p="$4" br="$6" bg={styles.bg} bw={1} borderColor={styles.borderColor}>
      {eyebrow ? (
        <Paragraph variant="annotation" color={tone === 'danger' ? '$danger-600' : '$grey-600'}>
          {eyebrow}
        </Paragraph>
      ) : null}
      {title ? (
        <Heading heading="sub2" color={styles.titleColor}>
          {title}
        </Heading>
      ) : null}
      {description ? <Paragraph color={styles.bodyColor}>{description}</Paragraph> : null}
      {children}
    </YStack>
  )
}

export function ConsentCredentialPreview({ credentialDisplay }: { credentialDisplay: CredentialDisplay }) {
  return (
    <ConsentSection>
      <MiniCardRowItem
        name={credentialDisplay.name ?? 'Credential'}
        subtitle={credentialDisplay.issuer.name ?? 'Unknown issuer'}
        issuerImageUri={credentialDisplay.issuer.logo?.url}
        backgroundImageUri={credentialDisplay.backgroundImage?.url}
        backgroundColor={credentialDisplay.backgroundColor ?? '$grey-900'}
      />
    </ConsentSection>
  )
}

export function ConsentLoadingSection({
  title,
  description,
}: {
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <YStack ai="center" gap="$4" py="$4" px="$2">
      <PinDotsIndicator />
      <Heading heading="sub2" ta="center">
        {title}
      </Heading>
      {description ? (
        <Paragraph ta="center" color="$grey-700">
          {description}
        </Paragraph>
      ) : null}
    </YStack>
  )
}

export function ConsentErrorState({
  title,
  description,
}: {
  title: ReactNode
  description: ReactNode
}) {
  const { t } = useLingui()

  return (
    <ConsentSection
      tone="danger"
      title={title}
      description={description}
      eyebrow={t(commonMessages.pleaseTryAgain)}
    >
      <XStack ai="center" gap="$2">
        <HeroIcons.ExclamationTriangleFilled color="$danger-600" size={20} />
        <Paragraph color="$danger-700">
          {t({
            id: 'consent.errorAction',
            message: 'Close this flow and try again.',
            comment: 'Short action hint shown below fatal consent errors',
          })}
        </Paragraph>
      </XStack>
    </ConsentSection>
  )
}

export function ConsentAuthSection({
  title,
  description,
  summaryLabel,
  summaryValue,
  pinRef,
  onPinComplete,
  onBiometricsTap,
  biometricsType,
  isLoading,
}: {
  title: ReactNode
  description: ReactNode
  summaryLabel?: ReactNode
  summaryValue?: ReactNode
  pinRef?: RefObject<PinDotsInputRef | null>
  onPinComplete: (pin: string) => void
  onBiometricsTap?: () => void
  biometricsType?: 'face' | 'fingerprint'
  isLoading?: boolean
}) {
  return (
    <YStack gap="$4">
      <Heading heading="sub2">{title}</Heading>
      <Paragraph>{description}</Paragraph>
      {summaryLabel ? (
        <YStack gap="$1">
          <Paragraph variant="annotation" color="$grey-600">
            {summaryLabel}
          </Paragraph>
          <Paragraph>{summaryValue}</Paragraph>
        </YStack>
      ) : null}
      <PinDotsInput
        ref={pinRef}
        onPinComplete={onPinComplete}
        onBiometricsTap={onBiometricsTap}
        biometricsType={biometricsType}
        isLoading={isLoading}
        pinLength={6}
        pinPadHorizontalBleed={0}
        useNativeKeyboard={false}
      />
    </YStack>
  )
}
