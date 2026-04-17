import { Paragraph, XStack, YStack } from '@package/ui'
import type { CredentialForDisplay } from '@paradym/wallet-sdk'
import { Image } from 'expo-image'
import type { ComponentProps, ReactNode } from 'react'
import { Pressable } from 'react-native'

interface CredentialCardProps {
  credentialDisplay: CredentialForDisplay['display']
  title?: string
  subtitle?: string
  onPress?: () => void
  isSelectable?: boolean
  rightElement?: ReactNode
}

export function CredentialCard({
  credentialDisplay,
  title,
  subtitle,
  onPress,
  isSelectable = false,
  rightElement,
}: CredentialCardProps) {
  const imageSource = credentialDisplay.backgroundImage?.url ?? credentialDisplay.issuer.logo?.url

  const imageProps: ComponentProps<typeof Image> = {
    source: imageSource,
    style: { width: 40, height: 40, borderRadius: 20 },
    contentFit: 'contain',
  }

  const backgroundColor = '#F8FAFB'
  const textColor = '$grey-900'
  const borderColor = '#EAEDEF'
  const cardTitle = title ?? credentialDisplay.name
  const normalizedSubtitle = subtitle?.trim()
  const shouldShowSubtitle = normalizedSubtitle && normalizedSubtitle !== cardTitle?.trim()

  return (
    <Pressable onPress={onPress} disabled={!isSelectable}>
      <XStack
        backgroundColor={backgroundColor}
        borderWidth={0.5}
        borderColor={borderColor}
        borderRadius={20}
        px="$4"
        height={76}
        alignItems="center"
      >
        {imageSource && <Image {...imageProps} />}
        <YStack flex={1} pl="$3" jc="center">
          <Paragraph fontWeight="bold" numberOfLines={1} color={textColor}>
            {cardTitle}
          </Paragraph>
          {shouldShowSubtitle ? (
            <Paragraph color={credentialDisplay.textColor ?? '$grey-600'} variant="sub" numberOfLines={1}>
              {subtitle}
            </Paragraph>
          ) : null}
        </YStack>
        {isSelectable ? rightElement : null}
      </XStack>
    </Pressable>
  )
}
